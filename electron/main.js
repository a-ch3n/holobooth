/**
 * HoloBooth — Electron main process.
 *
 * Owns the things a browser tab can't: kiosk window, silent printing to the
 * dye-sub, filesystem, the payment bridge, and the local media server.
 */
const { app, BrowserWindow, ipcMain, session, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'booth.config.json');
const LOCAL_CONFIG_PATH = path.join(ROOT, 'config', 'booth.config.local.json');
const { readLocal, applyLocal, stripLocal } = require('./local-config');
const DATA_DIR = path.join(app.getPath('userData'), 'holobooth');
const DEV = !!process.env.HOLOBOOTH_DEV;

let win = null;
let printWin = null;
let config = loadConfig();

/**
 * Windows camera API. Media Foundation (Chromium's default) is what the
 * Windows Camera app uses. camera.windowsCaptureApi: "directshow" switches
 * to the API OBS uses instead: turning the Media Foundation feature off
 * makes Chromium fall back to its DirectShow capture code (checked present
 * in Electron 32's Windows build). Must be set before the app is ready.
 */
if (process.platform === 'win32' && config.camera?.windowsCaptureApi === 'directshow') {
  app.commandLine.appendSwitch('disable-features', 'MediaFoundationVideoCapture,MediaFoundationD3D11VideoCapture');
}

/**
 * These cards send MJPEG, and Chromium decodes it on the graphics chip
 * ("Hardware MFT"). On some GPUs that decoder stalls after a few seconds,
 * freezing the preview, while the Windows Camera app, which doesn't use it,
 * runs fine. Decoding 1080p30 MJPEG in software is cheap on any booth PC.
 * camera.windowsHardwareMjpeg: true to use the GPU decoder again.
 */
if (process.platform === 'win32' && config.camera?.windowsHardwareMjpeg !== true) {
  app.commandLine.appendSwitch('disable-accelerated-mjpeg-decode');
}

/* ------------------------------------------------------------- config */

function readBaseConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.error('[config] failed to read booth.config.json:', e.message);
    return {};
  }
}

/** booth.config.json plus this booth's gitignored booth.config.local.json. */
function loadConfig() {
  const local = readLocal(LOCAL_CONFIG_PATH);
  if (local) console.log(`[config] using booth.config.local.json${local.server?.url ? ` — server ${local.server.url}` : ''}`);
  return testPayments(applyLocal(readBaseConfig(), local));
}

/**
 * Test vs real payments without editing the config: npm run dev (and
 * npm run start:test) take every sale through the mock reader, and the kiosk
 * shows a TEST MODE badge; npm start (and npm run dev:live) use the real
 * provider. HOLOBOOTH_PAYMENTS=mock|live overrides either way.
 */
function testPayments(cfg) {
  const env = process.env.HOLOBOOTH_PAYMENTS;
  const mock = env ? env === 'mock' : DEV;
  if (!mock || !cfg.payments) return cfg;
  console.log(`[config] TEST MODE — payments are simulated (real provider: ${cfg.payments.provider})`);
  return { ...cfg, payments: { ...cfg.payments, realProvider: cfg.payments.provider, provider: 'mock', testMode: true } };
}

function saveConfig(next) {
  config = next;
  // Test mode is a launch option, not a setting: never save it.
  next = structuredClone(next);
  if (next.payments?.testMode) {
    next.payments.provider = next.payments.realProvider;
    delete next.payments.testMode;
    delete next.payments.realProvider;
  }
  // Never write the local file's values (the kiosk key) into the committed config.
  const clean = stripLocal(next, readBaseConfig(), readLocal(LOCAL_CONFIG_PATH));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(clean, null, 2));
  return true;
}

/* --------------------------------------------------------------- store */

// Flat JSONL ledger. Small, append-only, trivially syncable, and survives a
// power cut mid-event better than a database you forgot to checkpoint.
function ledgerPath(name) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return path.join(DATA_DIR, name);
}

function appendLedger(name, row) {
  fs.appendFileSync(ledgerPath(name), JSON.stringify(row) + '\n');
}

function readLedger(name) {
  try {
    return fs.readFileSync(ledgerPath(name), 'utf8')
      .split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

/** Next mint number for a frame in the current season — the collectible counter. */
function nextMint(seasonId, frameId) {
  const rows = readLedger('cards.jsonl');
  const n = rows.filter(r => r.seasonId === seasonId && r.frameId === frameId).length;
  return n + 1;
}

/* -------------------------------------------------------------- window */

function createWindow() {
  const display = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: DEV ? 1280 : display.workAreaSize.width,
    height: DEV ? 900 : display.workAreaSize.height,
    fullscreen: !DEV && config.booth?.kiosk !== false,
    kiosk: !DEV && config.booth?.kiosk !== false,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The HDMI capture card shows up as a normal getUserMedia device.
      // Autoplay must be allowed or the live preview never starts unattended.
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });

  // Grant camera without a prompt — there is nobody at the kiosk to click "Allow".
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'fullscreen', 'pointerLock'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  win.loadFile(path.join(ROOT, 'src', 'index.html'));
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ------------------------------------------------------------ printing */

/**
 * Print a data-URL image at an exact physical size.
 *
 * Dye-subs are unforgiving: the page must be the exact media size with zero
 * margins, or the driver silently scales and your 2.5x3.5 card comes out at
 * 2.42x3.39 and no longer fits a card sleeve.
 *
 * On macOS and Linux, hand this straight to `lp` via the same code the Pi
 * build already uses (pi/print.mjs) instead of Electron's own silent-print
 * API. That's not a style choice — webContents.print({ silent: true }) has
 * a real bug on macOS where the callback reports success while the job
 * never reaches the OS print spooler at all (confirmed against a real DNP
 * DS40: non-silent printing and printing from every other app worked fine,
 * silent printing through Electron vanished every time). `lp` is the same
 * CUPS underneath either OS, so the Pi's exact-geometry PDF approach works
 * unmodified here too.
 *
 * Windows has no CUPS, so it keeps the original @page-sized BrowserWindow
 * printed through Electron's API, which doesn't have this bug there.
 */
async function printImage({ dataUrl, widthIn, heightIn, printerName, copies = 1, silent = true, pageSize = null, lpOptions = [], windowsPaper = null }) {
  console.log(`[print] ${process.platform} request: ${widthIn}x${heightIn}in, printer=${printerName || '(OS default)'}, copies=${copies}, silent=${silent}, pageSize=${pageSize || '(custom size)'}`);

  if (process.platform !== 'win32') {
    const { printImage: printViaCups } = await import('../pi/print.mjs');
    const result = await printViaCups({
      dataUrl, widthIn, heightIn, printerName, copies, pageSize,
      // Per-job options (e.g. the DS40 strip sheet's Cutter=2Inch) first, so
      // a global booth.config.json override of the same key still wins.
      lpOptions: [...(lpOptions || []), ...(config.printing?.lpOptions || [])],
      dryRun: !!config.printing?.dryRun,
    });
    console.log('[print] lp result:', JSON.stringify(result));
    return result;
  }

  // Pick the actual photo printer, not whatever Windows calls the default.
  const printers = await win.webContents.getPrintersAsync().catch(() => []);
  const choice = require('./printers').choosePrinter(printers, printerName);
  if (choice.error) {
    console.error(`[print] ${choice.error}`);
    return { ok: false, reason: choice.error };
  }
  console.log(`[print] printing to "${choice.name}" (${choice.why})`);
  printerName = choice.name;

  // Default: through the driver's own paper sizes, like Windows' test page
  // (see electron/winprint.js). printing.windowsMethod: "chromium" = the old way.
  // classic (default): the Chromium print that worked on this DS40 in
  // September — landscape for a wide sheet, so Windows sends the driver its
  // own 4x6 paper turned sideways. driver / browser: alternatives kept for
  // other printers (operator panel → Print method).
  const wp = require('./winprint');
  // 'photo' (Windows Photo Viewer) is gone: ImageView_PrintTo isn't exported
  // on current Windows 11 ("Missing entry"), so anyone who picked it gets XPS.
  const want = config.printing?.windowsMethod === 'photo' ? 'xps' : config.printing?.windowsMethod || 'xps';
  const method = ['xps', 'driver', 'browser', 'classic'].includes(want) ? want : 'xps';
  if (method === 'xps') {
    const r = await wp.printXps({
      dataUrl, widthIn, heightIn, printer: printerName,
      copies: Math.max(1, Math.min(copies, config.printing?.copiesMax || 4)),
    });
    await new Promise(res => setTimeout(res, 3000));
    const queue = wp.summarize(await wp.diagnose(), printerName);
    console.log(`[print] xps result: ${JSON.stringify(r)}\n${queue}`);
    return { ...r, paper: `${r.paper || ''}\n${queue}` };
  }
  if (method === 'photo' && wp.photoViewerDll()) {
    const r = await wp.printPhotoViewer({
      dataUrl, printer: printerName,
      copies: Math.max(1, Math.min(copies, config.printing?.copiesMax || 4)),
    });
    await new Promise(res => setTimeout(res, 3000));
    const queue = wp.summarize(await wp.diagnose(), printerName);
    console.log(`[print] photo viewer result: ${JSON.stringify(r)}\n${queue}`);
    return { ...r, paper: `${r.paper || ''} printer="${printerName}"\n${queue}` };
  }
  if (method === 'driver') {
    const r = await require('./winprint').printWindows({
      dataUrl, widthIn, heightIn, printer: printerName,
      copies: Math.max(1, Math.min(copies, config.printing?.copiesMax || 4)),
      paperHint: windowsPaper || '',
    });
    console.log(`[print] windows (driver paper) result: ${JSON.stringify(r)}`);
    return r;
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${widthIn}in ${heightIn}in; margin: 0; }
    html,body { margin:0; padding:0; width:${widthIn}in; height:${heightIn}in;
                background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    img { display:block; width:${widthIn}in; height:${heightIn}in; object-fit:cover; }
  </style></head><body><img src="${dataUrl}"></body></html>`;

  if (printWin) { try { printWin.destroy(); } catch {} }
  printWin = new BrowserWindow({ show: false });
  await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  const opts = {
    silent,
    printBackground: true,
    // A wide sheet must be sent as landscape: without it Windows hands the
    // DS40 a page wider than its 4x6 paper and the driver drops the job
    // (Sept 21's landscape:false, meant for the Mac, stopped Windows printing).
    landscape: widthIn > heightIn,
    copies: Math.max(1, Math.min(copies, config.printing?.copiesMax || 4)),
    margins: { marginType: 'none' },
    pageSize: {
      // Electron wants microns.
      width: Math.round(widthIn * 25400),
      height: Math.round(heightIn * 25400),
    },
  };
  // "browser": no custom size — print on the printer's own default paper
  // (DNP's driver only accepts its own forms), turned to suit the sheet.
  if (method === 'browser') delete opts.pageSize;
  if (printerName) opts.deviceName = printerName;

  console.log('[print] windows webContents.print options:', JSON.stringify(opts));

  return new Promise(resolve => {
    printWin.webContents.print(opts, (ok, reason) => {
      try { printWin.destroy(); } catch {}
      printWin = null;
      console.log(`[print] windows result: ok=${ok}${reason ? `, reason=${reason}` : ''}`);
      // What happened to the job after Chromium handed it to Windows.
      setTimeout(async () => {
        const { diagnose, summarize } = require('./winprint');
        const queue = summarize(await diagnose(), printerName);
        console.log(`[print] after print:\n${queue}`);
        resolve({ ok, reason: reason || null, paper: `method=${method} printer="${printerName}" landscape=${opts.landscape}\n${queue}` });
      }, 3000);
    });
  });
}

/* ----------------------------------------------------------------- IPC */

ipcMain.handle('config:get', () => config);
ipcMain.handle('config:save', (_e, next) => saveConfig(next));
ipcMain.handle('config:reload', () => (config = loadConfig()));

ipcMain.handle('printers:list', async () => {
  try {
    const list = await win.webContents.getPrintersAsync();
    if (process.platform !== 'win32') return list;
    // Mark the one a card would actually go to, for the operator panel.
    const { choosePrinter } = require('./printers');
    const cards = choosePrinter(list, config.printing?.cardPrinterName || null);
    const strips = choosePrinter(list, config.printing?.stripPrinterName || config.printing?.cardPrinterName || null);
    return list.map(p => ({ ...p, willUse: p.name === cards.name, willUseStrips: p.name === strips.name }));
  } catch { return []; }
});

ipcMain.handle('print:image', (_e, args) => printImage(args));

// The chosen printer's own paper sizes, for the operator panel (and for
// working out which one is the DS40's 2-inch-cut size).
ipcMain.handle('printers:papers', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const list = await win.webContents.getPrintersAsync().catch(() => []);
  const choice = require('./printers').choosePrinter(list, config.printing?.cardPrinterName || null);
  if (choice.error) return { ok: false, error: choice.error };
  return { ok: true, printer: choice.name, sizes: await require('./winprint').paperSizes(choice.name) };
});

// "Check printer" in the operator panel: what Windows says about every
// printer, port and queued job.
ipcMain.handle('printers:diagnose', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const { diagnose, summarize } = require('./winprint');
  const d = await diagnose();
  return { ok: d.ok, text: summarize(d), raw: d };
});

// Print method switch in the operator panel: this PC only.
ipcMain.handle('printers:method', (_e, method) => {
  if (!['xps', 'classic', 'driver', 'browser'].includes(method)) return { ok: false, error: `Unknown method ${method}` };
  require('./local-config').writeLocalPatch(LOCAL_CONFIG_PATH, { printing: { windowsMethod: method } });
  config = loadConfig();
  console.log(`[print] operator chose print method "${method}"`);
  return { ok: true, config };
});

// "Use this printer" in the operator panel. Saved to this PC's
// booth.config.local.json, never the committed config; the renderer can
// set only these two keys through here.
ipcMain.handle('printers:use', async (_e, name, role = 'both') => {
  const list = await win.webContents.getPrintersAsync().catch(() => []);
  if (!list.some(p => p.name === name)) return { ok: false, error: `No printer named "${name}"` };
  const printing = role === 'cards' ? { cardPrinterName: name }
    : role === 'strips' ? { stripPrinterName: name }
    : { cardPrinterName: name, stripPrinterName: name };
  require('./local-config').writeLocalPatch(LOCAL_CONFIG_PATH, { printing });
  config = loadConfig();
  console.log(`[print] operator chose "${name}" for ${role}`);
  return { ok: true, config };
});

ipcMain.handle('cards:nextMint', (_e, { seasonId, frameId }) => nextMint(seasonId, frameId));

ipcMain.handle('cards:record', (_e, card) => {
  appendLedger('cards.jsonl', card);
  return true;
});

ipcMain.handle('cards:stats', (_e, { seasonId }) => {
  const rows = readLedger('cards.jsonl').filter(r => r.seasonId === seasonId);
  const byFrame = {};
  const byRarity = {};
  for (const r of rows) {
    byFrame[r.frameId] = (byFrame[r.frameId] || 0) + 1;
    byRarity[r.rarity] = (byRarity[r.rarity] || 0) + 1;
  }
  return { total: rows.length, byFrame, byRarity, recent: rows.slice(-12).reverse() };
});

ipcMain.handle('sales:record', (_e, sale) => {
  appendLedger('sales.jsonl', sale);
  return true;
});

ipcMain.handle('sales:summary', () => {
  const rows = readLedger('sales.jsonl');
  const today = new Date().toDateString();
  const todays = rows.filter(r => new Date(r.at).toDateString() === today);
  const sum = a => a.reduce((t, r) => t + (r.amount || 0), 0);
  return {
    todayCount: todays.length, todayGross: sum(todays),
    allCount: rows.length, allGross: sum(rows),
    byProduct: rows.reduce((m, r) => ((m[r.productId] = (m[r.productId] || 0) + 1), m), {}),
  };
});

ipcMain.handle('media:save', (_e, { name, dataUrl }) => {
  const dir = path.join(DATA_DIR, 'media', new Date().toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const b64 = dataUrl.split(',')[1];
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
});

/* ------------------------------------------------------------- stills */

// Real photos over USB (focus, shutter, flash) — see electron/stills.js.
// Rebuilt whenever camera.stills changes, so a config reload takes effect.
const { createStills } = require('./stills');
let stills = null, stillsKey = '';
function getStills() {
  const cfg = config.camera?.stills || {};
  const key = JSON.stringify(cfg);
  if (!stills || key !== stillsKey) {
    stills = createStills(cfg, { dir: path.join(DATA_DIR, 'stills', new Date().toISOString().slice(0, 10)) });
    stillsKey = key;
  }
  return stills;
}
// Plain { ok, … } results: a thrown error loses its message crossing IPC.
const stillsCall = fn => async () => {
  try { return { ok: true, ...(await fn(getStills())) }; } catch (e) { return { ok: false, error: e.message }; }
};
ipcMain.handle('stills:status', stillsCall(async s => { const st = await s.status(); if (!st.ok) throw new Error(st.message); return st; }));
ipcMain.handle('stills:liveview', stillsCall(async s => ({ jpeg: await s.liveview() })));
ipcMain.handle('stills:capture', stillsCall(s => s.capture()));

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  hostname: os.hostname(),
  dataDir: DATA_DIR,
  dev: DEV,
}));

ipcMain.handle('app:quit', () => app.quit());
ipcMain.handle('app:reload', () => win?.reload());

/**
 * Which known camera-grabbing programs are running (Windows). A capture card
 * serves one program at a time, and "camera is busy" is useless without
 * knowing who has it. Names only — no process is touched.
 */
const CAMERA_HOLDERS = [
  [/^obs(64|32)?\.exe$/i, 'OBS Studio'],
  [/lumabooth/i, 'Lumabooth'],
  [/^WindowsCamera\.exe$/i, 'Windows Camera app'],
  [/^(ms-)?teams\.exe$/i, 'Microsoft Teams'],
  [/^zoom\.exe$/i, 'Zoom'],
  [/^discord\.exe$/i, 'Discord'],
  [/^CameraControl\.exe$/i, 'digiCamControl'],
  [/EOS.?Webcam/i, 'EOS Webcam Utility'],
  [/dslrbooth/i, 'dslrBooth'],
  [/^Skype/i, 'Skype'],
];
ipcMain.handle('app:cameraHolders', () => new Promise(resolve => {
  if (process.platform !== 'win32') return resolve([]);
  require('node:child_process').execFile('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 5000 }, (err, out) => {
    if (err) return resolve([]);
    const names = new Set(String(out).split(/\r?\n/).map(l => l.split('","')[0].replace(/^"/, '')).filter(Boolean));
    resolve([...new Set([...names].flatMap(n => CAMERA_HOLDERS.filter(([re]) => re.test(n)).map(([, label]) => label)))]);
  });
}));

/* ----------------------------------------------------------- lifecycle */

// One HoloBooth at a time: a second copy (an old run still open behind the
// kiosk window, or npm run dev started twice) would fight over the camera.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
