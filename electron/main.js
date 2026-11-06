/**
 * HoloBooth — Electron main process.
 *
 * Owns the things a browser tab can't: kiosk window, silent printing to the
 * dye-sub, filesystem, the payment bridge, and the local media server.
 */
const { app, BrowserWindow, ipcMain, session, shell, screen, nativeImage } = require('electron');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'booth.config.json');
const LOCAL_CONFIG_PATH = path.join(ROOT, 'config', 'booth.config.local.json');
const { readLocal, applyLocal, stripLocal, writeLocalPatch } = require('./local-config');
const DATA_DIR = path.join(app.getPath('userData'), 'holobooth');
const DEV = !!process.env.HOLOBOOTH_DEV;

let win = null;
let config = loadConfig();

/**
 * Which code is running, for the build stamp on every print and preview:
 * the commit of this checkout (read from .git, no git needed), or for a
 * packaged build the commit `npm run dist` wrote to electron/build-info.json.
 * time: when the print code on disk last changed (or the build time).
 */
function readBuildInfo() {
  const info = { commit: null, time: null, source: 'unknown', packaged: app.isPackaged, root: ROOT };
  try {
    const b = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8'));
    Object.assign(info, { commit: b.commit || null, time: b.time || null, source: 'build-info.json (packaged build)' });
  } catch {}
  if (!info.commit) {
    try {
      const gitDir = path.join(ROOT, '.git');
      let head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
      if (head.startsWith('ref: ')) {
        const ref = head.slice(5);
        const loose = path.join(gitDir, ref);
        head = fs.existsSync(loose)
          ? fs.readFileSync(loose, 'utf8').trim()
          : ((fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8').split('\n').find(l => l.endsWith(` ${ref}`)) || '').split(' ')[0]);
      }
      if (/^[0-9a-f]{40}$/.test(head)) Object.assign(info, { commit: head, source: 'git checkout' });
    } catch {}
  }
  if (!info.time) {
    const files = ['src/js/app.js', 'src/js/layout.mjs', 'electron/main.js'].map(f => path.join(ROOT, f));
    const t = Math.max(...files.map(f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }));
    if (t) info.time = new Date(t).toISOString();
  }
  return info;
}
const BUILD = readBuildInfo();
console.log(`[build] commit ${BUILD.commit ? BUILD.commit.slice(0, 7) : 'unknown'} (${BUILD.source}${BUILD.packaged ? ', packaged app' : ''}) at ${BUILD.root}, print code changed ${BUILD.time}`);

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
  migrateLocal();
  const local = readLocal(LOCAL_CONFIG_PATH);
  if (local) console.log(`[config] using booth.config.local.json${local.server?.url ? ` — server ${local.server.url}` : ''}`);
  return testPayments(applyLocal(readBaseConfig(), local));
}

/**
 * Printer names chosen in the operator panel used to be saved as
 * printing.cardPrinterName / stripPrinterName; they're printer.queue4x6 /
 * queueStrip now. Moves them once, in this PC's local file.
 */
function migrateLocal() {
  const local = readLocal(LOCAL_CONFIG_PATH);
  const p = local?.printing;
  if (!p || !('cardPrinterName' in p || 'stripPrinterName' in p)) return;
  local.printer = { ...(local.printer || {}) };
  if (p.cardPrinterName && !local.printer.queue4x6) local.printer.queue4x6 = p.cardPrinterName;
  if (p.stripPrinterName && !local.printer.queueStrip) local.printer.queueStrip = p.stripPrinterName;
  delete p.cardPrinterName; delete p.stripPrinterName;
  if (!Object.keys(p).length) delete local.printing;
  fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(local, null, 2));
  console.log('[config] moved printer names to printer.queue4x6 / queueStrip in booth.config.local.json');
}

/**
 * Test vs real payments without editing the config: npm run dev (and
 * npm run start:test) take every sale through the mock reader, and the kiosk
 * shows a TEST MODE badge; npm start (and npm run dev:live) use the real
 * provider. HOLOBOOTH_PAYMENTS=mock|live overrides either way.
 */
function testPayments(cfg) {
  const env = process.env.HOLOBOOTH_PAYMENTS;
  // A free event takes no payments either way: nothing to simulate.
  if (cfg.payments?.provider === 'free' && env !== 'mock') return cfg;
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
 * DNP DS40, 300 dpi, 6x4 media. Every page arrives as the printer's native
 * page: 1844 x 1240, 6x4 landscape, the 2-inch cut at y = 620. The kiosk
 * builds it with toPrinterNative() (src/js/layout.mjs), the only place that
 * rotates anything. Nothing in this file rotates a page.
 *
 *   kind "4x6"   → printer.queue4x6   (DS40 set to 4x6, no cut)
 *   kind "strip" → printer.queueStrip (Windows: a second DS40 queue set to
 *                  "2inch cut"; CUPS: same printer, PageSize w288h432-div2)
 *
 * Every page is saved as a PNG first (media/<date>/prints/), so the file
 * can be compared with what came out of the printer.
 *
 * Windows: printing.windowsMethod "chromium" (default) prints that PNG from
 * a dedicated window holding only the image; "xps" goes through Windows'
 * XPS path instead (winprint-xps.ps1). Linux / Raspberry Pi / macOS: `lp`,
 * with options read from `lpoptions -p <printer> -l` (pi/print.mjs).
 */
const NATIVE = { W: 1844, H: 1240 };

function printerCfg() {
  return { os: 'auto', queue4x6: null, queueStrip: null, finish: 'glossy', copies: 1, lpOptions: [], ...(config.printer || {}) };
}

function printOs(pc = printerCfg()) {
  if (pc.os === 'windows' || pc.os === 'cups') return pc.os;
  return process.platform === 'win32' ? 'windows' : 'cups';
}

function savePrintFile(dataUrl, kind, label) {
  const now = new Date();
  // Test prints in their own folder, so they're easy to find and compare.
  const dir = /^test-/.test(String(label))
    ? path.join(DATA_DIR, 'media', 'test-prints')
    : path.join(DATA_DIR, 'media', now.toISOString().slice(0, 10), 'prints');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toTimeString().slice(0, 8).replace(/:/g, '') + String(now.getMilliseconds()).padStart(3, '0');
  const safe = String(label || '').replace(/[^\w-]+/g, '_').slice(0, 40);
  const file = path.join(dir, `${stamp}-${kind}${safe ? `-${safe}` : ''}.png`);
  fs.writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1] || '', 'base64'));
  return file;
}

/** printer.dryRun: on unless the config says false. */
function isDryRun(pc = printerCfg()) {
  return pc.dryRun !== false;
}

/**
 * The back end of the renderer's sendToPrinter() (src/js/app.js), the one
 * function every print goes through after toPrinterNative(). Nothing else
 * in the app prints.
 *
 * @param {{ dataUrl: string, kind: '4x6'|'strip', copies?: number, label?: string,
 *           jobType?: '4x6'|'strip'|'cards', force?: boolean }} job
 *   dataUrl: PNG, the native page: exactly 1844x1240.
 *   force: print for real although printer.dryRun is on (the preview
 *   panel's "print for real" button, one copy).
 */
async function printImage({ dataUrl, kind = '4x6', copies = 1, label = '', jobType = null, force = false } = {}) {
  const pc = printerCfg();
  kind = kind === 'strip' ? 'strip' : '4x6';
  jobType = ['4x6', 'strip', 'cards'].includes(jobType) ? jobType : kind;
  if (config.printing?.enabled === false) return { ok: false, reason: 'Printing is turned off (printing.enabled in booth.config.json)' };
  if (!/^data:image\/png;base64,/.test(String(dataUrl))) return { ok: false, reason: 'print: expected a PNG data URL' };

  const img = nativeImage.createFromDataURL(dataUrl);
  const { width, height } = img.getSize();
  // Only the printer-native page (toPrinterNative in src/js/layout.mjs).
  if (width !== NATIVE.W || height !== NATIVE.H) {
    return { ok: false, reason: `The page is ${width}x${height} px; the printer is only sent its native ${NATIVE.W}x${NATIVE.H} page` };
  }
  const os = printOs(pc);
  const queue = kind === 'strip' ? (pc.queueStrip || pc.queue4x6) : pc.queue4x6;

  if (isDryRun(pc) && !force) return previewPage({ dataUrl, img, kind, jobType, label, width, height, os, queue });

  // Saved before anything is sent, so a failed print still leaves the file.
  const file = savePrintFile(dataUrl, kind, label);
  const n = force ? 1 : Math.max(1, Math.min(Math.round(copies * (pc.copies || 1)), config.printing?.copiesMax || 10));
  const notes = [];
  if (kind === 'strip' && !pc.queueStrip && os === 'windows') {
    notes.push('printer.queueStrip is not set: strips go to the 4x6 queue and will NOT be cut (README → Two DS40 queues)');
  }
  console.log(`[print] ${jobType} ${width}x${height} native x${n}${force ? ' (from the preview)' : ''} → ${os} queue "${queue || '(auto)'}" — saved ${file}`);

  if (os === 'cups') {
    const { printImage: printViaCups, listPrinters } = await import('../pi/print.mjs');
    // No queue configured: the photo printer by name, not the system default.
    const auto = queue ? { name: queue } : require('./printers').choosePrinter(await listPrinters(), null);
    if (auto.error) return { ok: false, reason: auto.error.replace(/ in Windows|Install the DNP.*$/g, ''), file };
    const r = await printViaCups({
      jpeg: img.toJPEG(100), kind, printerName: auto.name, copies: n,
      finish: pc.finish, lpOptions: pc.lpOptions,
    });
    console.log('[print] lp:', JSON.stringify(r));
    return { ...r, file, notes: [...notes, ...(r.problems || [])], paper: `${r.command || ''}${r.options?.length ? ` (${r.options.join(', ')})` : ''}` };
  }

  // Windows: the configured queue, or else the photo printer found by name.
  const printers = await win.webContents.getPrintersAsync().catch(() => []);
  const choice = require('./printers').choosePrinter(printers, queue);
  if (choice.error) {
    console.error(`[print] ${choice.error}`);
    return { ok: false, reason: choice.error, file };
  }
  console.log(`[print] printing to "${choice.name}" (${choice.why})`);
  const wp = require('./winprint');
  const method = config.printing?.windowsMethod === 'xps' ? 'xps' : 'chromium';
  const r = method === 'xps'
    ? await wp.printXps({ file, widthIn: 6, heightIn: 4, printer: choice.name, copies: n })
    : await printChromium({ file, width, height, deviceName: choice.name, copies: n });
  console.log(`[print] ${method} result: ${JSON.stringify(r)}`);
  // What happened to the job after it was handed to Windows.
  await new Promise(res => setTimeout(res, 3000));
  const queueState = wp.summarize(await wp.diagnose(), choice.name);
  console.log(`[print] after print:\n${queueState}`);
  return { ...r, file, notes, paper: `method=${method} printer="${choice.name}" ${r.paper || ''}\n${queueState}` };
}

/**
 * printer.dryRun: nothing goes to the printer. The exact native PNG is
 * saved to previews/<timestamp>_<jobtype>.png, and the PDF of what the
 * printer would get to previews/<timestamp>_<jobtype>.pdf, which is opened
 * in the system viewer:
 *   Windows: printToPDF of the SAME print page printChromium() prints
 *            (openPrintPage), 6 x 4 in, margins 0, printBackground,
 *            preferCSSPageSize.
 *   CUPS:    the exact PDF that would be handed to lp (pi/print.mjs).
 */
async function previewPage({ dataUrl, img, kind, jobType, label, width, height, os, queue }) {
  const dir = path.join(DATA_DIR, 'previews');
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const p2 = v => String(v).padStart(2, '0');
  const ts = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}-${String(now.getMilliseconds()).padStart(3, '0')}`;
  const base = path.join(dir, `${ts}_${jobType}${/^test-/.test(String(label)) ? '-test' : ''}`);
  const png = `${base}.png`, pdf = `${base}.pdf`;
  fs.writeFileSync(png, Buffer.from(String(dataUrl).split(',')[1] || '', 'base64'));

  let how;
  if (os === 'cups') {
    const { printImage: printViaCups } = await import('../pi/print.mjs');
    const pc = printerCfg();
    const r = await printViaCups({ jpeg: img.toJPEG(100), kind, printerName: queue, copies: 1, finish: pc.finish, lpOptions: pc.lpOptions, dryRun: true });
    if (!r.ok) return { ok: false, dryRun: true, reason: r.reason, png };
    fs.copyFileSync(r.file, pdf);
    how = `the PDF lp would get: ${r.command}`;
  } else {
    const page = await openPrintPage({ file: png, width, height });
    if (!page.ok) return { ok: false, dryRun: true, reason: page.reason, png };
    try {
      fs.writeFileSync(pdf, await page.win.webContents.printToPDF(PREVIEW_PDF));
    } finally {
      page.close();
    }
    how = `printToPDF of the print page (${JSON.stringify(PREVIEW_PDF)})`;
  }
  const openError = process.env.HOLOBOOTH_NO_OPEN ? 'not opened (HOLOBOOTH_NO_OPEN)' : await shell.openPath(pdf);
  console.log(`[print] PREVIEW ONLY (printer.dryRun) ${jobType} → ${png} + ${pdf}; ${how}${openError ? ` — ${openError}` : ''}`);
  return {
    ok: true, dryRun: true, png, pdf, jobType, kind, queue: queue || '(auto)', os, how,
    file: png,
    paper: `PREVIEW ONLY, nothing sent to the printer (printer.dryRun)\nPNG ${png}\nPDF ${pdf}`,
    notes: openError && !process.env.HOLOBOOTH_NO_OPEN ? [`couldn't open the PDF: ${openError}`] : [],
  };
}

/** The preview PDF: the print page at 6 x 4 in, nothing added or scaled. */
const PREVIEW_PDF = {
  pageSize: { width: 6, height: 4 },                     // inches
  margins: { top: 0, bottom: 0, left: 0, right: 0 },
  printBackground: true,
  preferCSSPageSize: true,
};

/**
 * The print page: a hidden window holding only the image, a 6 in x 4 in
 * page. The image is the printer's native page and fills the page exactly;
 * no cropping, no rotation. Used by printChromium() for real prints and by
 * previewPage() for the preview PDF, so the PDF is what the printer gets.
 */
async function openPrintPage({ file, width, height }) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: 6in 4in; margin: 0 }
  html, body { margin: 0; padding: 0; background: #fff;
               -webkit-print-color-adjust: exact; print-color-adjust: exact }
  img { display: block; width: 6in; height: 4in }
</style></head><body><img id="page" src="${pathToFileURL(file).href}"></body></html>`;
  const htmlPath = file.replace(/\.png$/i, '.print.html');
  fs.writeFileSync(htmlPath, html);
  const printWin = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  const close = () => setTimeout(() => { try { printWin.destroy(); } catch {} fs.rm(htmlPath, { force: true }, () => {}); }, 1000);
  try {
    await printWin.loadFile(htmlPath);
    // Wait for the image's load event before printing.
    const size = await printWin.webContents.executeJavaScript(`new Promise(r => {
      const i = document.getElementById('page');
      const done = () => r(i.naturalWidth ? [i.naturalWidth, i.naturalHeight] : null);
      if (i.complete) done(); else { i.onload = done; i.onerror = () => r(null); }
    })`);
    if (!size) { close(); return { ok: false, reason: `The print page couldn't load ${file}` }; }
    if (size[0] !== width || size[1] !== height) { close(); return { ok: false, reason: `The print page loaded ${size[0]}x${size[1]}, expected ${width}x${height}` }; }
    return { ok: true, win: printWin, close };
  } catch (e) {
    close();
    return { ok: false, reason: `The print page failed: ${e.message}` };
  }
}

/**
 * Prints the print page silently.
 *
 * On Windows, Chromium writes two things into the driver's DEVMODE
 * (printing/printing_context_win.cc): dmOrientation from `landscape`
 * (left out = PORTRAIT), and pageSize as a custom paper width x length.
 * So the paper is the DS40's own 4 x 6 in paper (4 in wide, 6 in long,
 * the size that is known to print) and `landscape: true` makes it a 6 in
 * wide x 4 in tall page, the same as the queue's Printing Preferences
 * (Landscape, (6x4)). Sending a 6 x 4 in custom paper in portrait instead
 * printed nothing on the DS40.
 *
 * Checked with printToPDF on this exact page: @page { size: 6in 4in } gives
 * a one-page PDF of 432 x 288 pt (6 x 4 in, landscape), no /Rotate, the
 * image upright and filling it edge to edge (1844 px across 6 in), and
 * webContents.print with this paper + landscape lays out the same page.
 */
async function printChromium({ file, width, height, deviceName, copies }) {
  const page = await openPrintPage({ file, width, height });
  if (!page.ok) return { ok: false, reason: page.reason };
  try {
    const opts = {
      silent: true,
      printBackground: true,
      deviceName,
      margins: { marginType: 'none' },
      scaleFactor: 100,
      copies,
      // The DS40's 4x6 paper (microns, as Windows defines it: 4 in wide,
      // 6 in long), turned landscape: a 6 in wide x 4 in tall page.
      pageSize: { width: 101600, height: 152400 },
      landscape: true,
    };
    console.log('[print] webContents.print', JSON.stringify(opts));
    return await new Promise(resolve => page.win.webContents.print(opts, (success, failureReason) =>
      resolve({ ok: success, reason: success ? null : (failureReason || 'print failed'), paper: `6x4in copies=${copies}` })));
  } finally {
    page.close();
  }
}

/* ----------------------------------------------------------------- IPC */

ipcMain.handle('config:get', () => config);
ipcMain.handle('config:save', (_e, next) => saveConfig(next));
ipcMain.handle('config:reload', () => (config = loadConfig()));

ipcMain.handle('printers:list', async () => {
  try {
    const pc = printerCfg();
    const list = await win.webContents.getPrintersAsync();
    // Mark where each kind of print goes, for the operator panel.
    const { choosePrinter } = require('./printers');
    const four = choosePrinter(list, pc.queue4x6 || null);
    const strips = choosePrinter(list, pc.queueStrip || pc.queue4x6 || null);
    return list.map(p => ({ ...p, willUse: p.name === four.name, willUseStrips: p.name === strips.name }));
  } catch { return []; }
});

ipcMain.handle('print:image', (_e, args) => printImage(args));

// The 4x6 queue's own paper sizes, for the operator panel (Windows).
ipcMain.handle('printers:papers', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const list = await win.webContents.getPrintersAsync().catch(() => []);
  const choice = require('./printers').choosePrinter(list, printerCfg().queue4x6 || null);
  if (choice.error) return { ok: false, error: choice.error };
  return { ok: true, printer: choice.name, sizes: await require('./winprint').paperSizes(choice.name) };
});

// Camera roles: the matched deviceId + label, saved on this PC only
// (deviceIds are per machine), so the next start opens the same camera.
ipcMain.handle('cameras:remember', (_e, role, { deviceId, label } = {}) => {
  if (!['standard', 'wide'].includes(role) || typeof deviceId !== 'string' || typeof label !== 'string') return { ok: false };
  writeLocalPatch(LOCAL_CONFIG_PATH, { cameras: { [role]: { deviceId, deviceLabel: label } } });
  config = loadConfig();
  console.log(`[camera] ${role} = "${label}"`);
  return { ok: true };
});

// Operator panel: open the folder with every session's photos (today's, if any).
ipcMain.handle('media:openFolder', async () => {
  const root = path.join(DATA_DIR, 'media');
  const today = path.join(root, new Date().toISOString().slice(0, 10));
  fs.mkdirSync(root, { recursive: true });
  const err = await shell.openPath(fs.existsSync(today) ? today : root);
  return { ok: !err, path: fs.existsSync(today) ? today : root, error: err || null };
});

// Operator panel "Event mode": how this booth takes payment, saved on this PC only.
const EVENT_MODES = {
  free: { provider: 'free' },
  reader: { provider: 'stripe-smart-reader', offerQr: true },
  qr: { provider: 'stripe-qr' },
};
ipcMain.handle('payments:mode', (_e, mode) => {
  if (!EVENT_MODES[mode]) return { ok: false, error: `Unknown event mode ${mode}` };
  require('./local-config').writeLocalPatch(LOCAL_CONFIG_PATH, { payments: EVENT_MODES[mode] });
  config = loadConfig();
  console.log(`[config] event mode → ${mode}`);
  return { ok: true, config };
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
  if (!['chromium', 'xps'].includes(method)) return { ok: false, error: `Unknown method ${method}` };
  writeLocalPatch(LOCAL_CONFIG_PATH, { printing: { windowsMethod: method } });
  config = loadConfig();
  console.log(`[print] operator chose print method "${method}"`);
  return { ok: true, config };
});

// Preview mode (printer.dryRun), switched on the diagnostics screen.
// Saved to this PC's booth.config.local.json.
ipcMain.handle('printers:dryRun', (_e, on) => {
  writeLocalPatch(LOCAL_CONFIG_PATH, { printer: { dryRun: !!on } });
  config = loadConfig();
  console.log(`[print] preview mode (printer.dryRun) ${on ? 'ON: nothing is sent to the printer' : 'OFF: prints go to the printer'}`);
  return { ok: true, dryRun: isDryRun(), config };
});

// "4x6" / "Strips" in the operator panel's printer list: which queue each
// kind of print goes to. Saved to this PC's booth.config.local.json, never
// the committed config; the renderer can set only these two keys here.
ipcMain.handle('printers:use', async (_e, name, role = 'cards') => {
  const list = await win.webContents.getPrintersAsync().catch(() => []);
  if (!list.some(p => p.name === name)) return { ok: false, error: `No printer named "${name}"` };
  const printer = role === 'strips' ? { queueStrip: name } : { queue4x6: name };
  writeLocalPatch(LOCAL_CONFIG_PATH, { printer });
  config = loadConfig();
  console.log(`[print] operator chose "${name}" for ${role === 'strips' ? 'strips' : '4x6'}`);
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
  const file = path.join(dir, path.basename(String(name)).replace(/[^\w.-]+/g, '_'));
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
  build: BUILD,
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
