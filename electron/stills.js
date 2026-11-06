/**
 * stills.js — real photos from a real camera, over USB.
 *
 * The video path (camera.js) reads frames off a webcam/HDMI feed, which can
 * never fire a flash or run the camera's one-shot autofocus. This drives the
 * camera the way Lumabooth does: focus, fire the shutter (and so the flash),
 * download the full-resolution JPEG. The same camera also supplies the live
 * view the customer sees while posing.
 *
 * Two backends, picked by camera.stills.backend ("auto" = by OS):
 *
 *   digicamcontrol  Windows. digiCamControl (free, digicamcontrol.com) owns
 *                   the camera through Canon's own SDK; we talk to its
 *                   built-in web server (File → Settings → Webserver).
 *   gphoto2         macOS / Linux / Raspberry Pi. `brew install gphoto2` or
 *                   `apt install gphoto2`.
 *
 * Shared by electron/main.js and pi/kiosk-server.mjs. Every call returns
 * plain data (base64 JPEGs), so it crosses IPC or JSON-RPC unchanged.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function createStills(cfg = {}, { dir, platform = process.platform, fetchImpl = globalThis.fetch, exec = execFile } = {}) {
  const backend = !cfg.backend || cfg.backend === 'auto'
    ? (platform === 'win32' ? 'digicamcontrol' : 'gphoto2')
    : cfg.backend;
  fs.mkdirSync(dir, { recursive: true });
  const timeoutMs = cfg.timeoutMs || 15000;
  if (backend === 'digicamcontrol') return digiCamControl(cfg.digicamcontrol || {}, { dir, timeoutMs, fetchImpl });
  if (backend === 'gphoto2') return gphoto2(cfg.gphoto2 || {}, { dir, timeoutMs, platform, exec });
  throw new Error(`Unknown camera.stills.backend "${backend}" — use "auto", "digicamcontrol" or "gphoto2".`);
}

/** Waits until a file exists and has stopped growing — the camera is still writing it otherwise. */
async function settledFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < deadline) {
    const size = fs.existsSync(file) ? fs.statSync(file).size : -1;
    if (size > 0 && size === last) return fs.readFileSync(file);
    last = size;
    await sleep(150);
  }
  throw new Error(`The photo never finished saving (${path.basename(file)}).`);
}

/* ======================================================== digiCamControl */

function digiCamControl(opts, { dir, timeoutMs, fetchImpl }) {
  const base = String(opts.url || 'http://127.0.0.1:5513').replace(/\/+$/, '');
  const captureCmd = opts.captureCmd || 'Capture';
  let folderSet = false;
  let liveViewOn = false;
  let shooting = false;

  const get = async (q, { timeout = 4000 } = {}) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetchImpl(`${base}${q}`, { signal: ac.signal });
      if (!res.ok) throw new Error(`digiCamControl ${q}: HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (e.name === 'AbortError' || /ECONNREFUSED|fetch failed/.test(`${e.message} ${e.cause?.code || ''}`)) {
        throw new Error(`Can't reach digiCamControl at ${base}. Is it running, with File → Settings → Webserver turned on?`);
      }
      throw e;
    } finally { clearTimeout(timer); }
  };
  const text = async q => (await (await get(q)).text()).trim();
  const lastCaptured = () => text('/?slc=get&param1=lastcaptured&param2=');

  // Saves land where we can read them straight off the disk.
  async function ensureFolder() {
    if (folderSet) return;
    await get(`/?slc=set&param1=session.folder&param2=${encodeURIComponent(dir)}`);
    folderSet = true;
  }

  return {
    backend: 'digicamcontrol',

    async status() {
      try {
        await ensureFolder();
        return { ok: true, message: `digiCamControl at ${base}` };
      } catch (e) { return { ok: false, message: e.message }; }
    },

    /** One live view frame, or null while the camera has none to give (e.g. mid-capture). */
    async liveview() {
      // Turning live view back on mid-shot would interrupt the capture.
      if (shooting) return null;
      if (!liveViewOn) { await get('/?CMD=LiveViewWnd_Show'); liveViewOn = true; await sleep(400); }
      const res = await get('/liveview.jpg', { timeout: 2500 });
      const buf = Buffer.from(await res.arrayBuffer());
      // A JPEG starts FF D8; anything else is an error page or an empty frame.
      return buf.length > 1000 && buf[0] === 0xff && buf[1] === 0xd8 ? buf.toString('base64') : null;
    },

    async capture() {
      shooting = true;
      try { return await shoot(); } finally { shooting = false; }
    },
  };

  async function shoot() {
    await ensureFolder();
    const before = await lastCaptured().catch(() => '');
    await get(`/?CMD=${encodeURIComponent(captureCmd)}`, { timeout: timeoutMs });
    const deadline = Date.now() + timeoutMs;
    let name = '';
    while (Date.now() < deadline) {
      name = await lastCaptured().catch(() => '');
      // "-" means a transfer is still in progress.
      if (name && name !== '-' && name !== before) break;
      name = '';
      await sleep(150);
    }
    if (!name) throw new Error('The camera didn\'t take a photo — check focus (AF can\'t lock in the dark) and that the camera is awake.');
    const file = path.isAbsolute(name) ? name : path.join(dir, name);
    let bytes;
    try {
      bytes = await settledFile(file, Math.max(3000, deadline - Date.now()));
    } catch {
      // Saved somewhere else (e.g. the session folder didn't take): ask the web server for it.
      bytes = Buffer.from(await (await get(`/image/${encodeURIComponent(path.basename(name))}`, { timeout: timeoutMs })).arrayBuffer());
    }
    liveViewOn = false; // digiCamControl stops live view to shoot; turn it back on next frame
    return { file, jpeg: bytes.toString('base64') };
  }
}

/* =============================================================== gphoto2 */

function gphoto2(opts, { dir, timeoutMs, platform, exec }) {
  const bin = opts.bin || 'gphoto2';
  // gphoto2 can only talk to the camera one command at a time.
  let queue = Promise.resolve();
  const run = (args, { encoding = 'utf8', timeout = timeoutMs } = {}) => {
    const job = queue.then(() => new Promise((resolve, reject) => {
      exec(bin, args, { encoding, timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || err.message).trim().split('\n').filter(Boolean).pop() || err.message;
          return reject(new Error(err.code === 'ENOENT' ? `gphoto2 isn't installed (${platform === 'darwin' ? 'brew' : 'sudo apt'} install gphoto2).` : `gphoto2: ${msg}`));
        }
        resolve(stdout);
      });
    }));
    queue = job.catch(() => {});
    return job;
  };

  // macOS starts its own PTP daemon on plug-in, which grabs the camera first.
  let freed = platform !== 'darwin';
  const freeCamera = async () => {
    if (freed) return;
    freed = true;
    await new Promise(r => exec('killall', ['PTPCamera', 'ptpcamerad'], {}, () => r()));
  };
  let n = 0;

  return {
    backend: 'gphoto2',

    async status() {
      try {
        await freeCamera();
        const out = await run(['--auto-detect'], { timeout: 8000 });
        const cams = out.split('\n').slice(2).map(l => l.trim()).filter(Boolean);
        if (!cams.length) return { ok: false, message: 'gphoto2 sees no camera — is it on, in photo mode, and plugged in by USB?' };
        return { ok: true, message: cams[0].replace(/\s+usb:.*$/, '') };
      } catch (e) { return { ok: false, message: e.message }; }
    },

    async liveview() {
      await freeCamera();
      const out = await run(['--capture-preview', '--stdout'], { encoding: 'buffer', timeout: 5000 });
      return out?.length > 1000 && out[0] === 0xff && out[1] === 0xd8 ? out.toString('base64') : null;
    },

    async capture() {
      await freeCamera();
      const stem = path.join(dir, `shot-${Date.now()}-${++n}`);
      // %C = the camera's own extension. Shoot JPEG only; RAW+JPEG leaves a
      // .cr3 beside it, which we ignore.
      await run(['--capture-image-and-download', '--force-overwrite', '--filename', `${stem}.%C`]);
      const jpg = ['jpg', 'JPG', 'jpeg', 'JPEG'].map(e => `${stem}.${e}`).find(f => fs.existsSync(f));
      if (!jpg) throw new Error('The camera saved no JPEG — set it to shoot JPEG (not RAW only).');
      return { file: jpg, jpeg: (await settledFile(jpg, 5000)).toString('base64') };
    },
  };
}

module.exports = { createStills };
