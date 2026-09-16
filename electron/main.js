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
const DATA_DIR = path.join(app.getPath('userData'), 'holobooth');
const DEV = !!process.env.HOLOBOOTH_DEV;

let win = null;
let printWin = null;
let config = loadConfig();

/* ------------------------------------------------------------- config */

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.error('[config] failed to read booth.config.json:', e.message);
    return {};
  }
}

function saveConfig(next) {
  config = next;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
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
 * 2.42x3.39 and no longer fits a card sleeve. We build a page whose CSS
 * @page size matches the media exactly and print with margins none.
 */
async function printImage({ dataUrl, widthIn, heightIn, printerName, copies = 1, silent = true }) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${widthIn}in ${heightIn}in; margin: 0; }
    html,body { margin:0; padding:0; width:${widthIn}in; height:${heightIn}in;
                background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    img { display:block; width:${widthIn}in; height:${heightIn}in; object-fit:cover; }
  </style></head><body><img src="${dataUrl}"></body></html>`;

  if (printWin) { try { printWin.destroy(); } catch {} }
  printWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  const opts = {
    silent,
    printBackground: true,
    copies: Math.max(1, Math.min(copies, config.printing?.copiesMax || 4)),
    margins: { marginType: 'none' },
    pageSize: {
      // Electron wants microns.
      width: Math.round(widthIn * 25400),
      height: Math.round(heightIn * 25400),
    },
  };
  if (printerName) opts.deviceName = printerName;

  return new Promise(resolve => {
    printWin.webContents.print(opts, (ok, reason) => {
      try { printWin.destroy(); } catch {}
      printWin = null;
      resolve({ ok, reason: reason || null });
    });
  });
}

/* ----------------------------------------------------------------- IPC */

ipcMain.handle('config:get', () => config);
ipcMain.handle('config:save', (_e, next) => saveConfig(next));
ipcMain.handle('config:reload', () => (config = loadConfig()));

ipcMain.handle('printers:list', async () => {
  try { return await win.webContents.getPrintersAsync(); } catch { return []; }
});

ipcMain.handle('print:image', (_e, args) => printImage(args));

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

/* ----------------------------------------------------------- lifecycle */

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
