/**
 * camera.js — the two booth cameras.
 *
 *   standard  Logitech Brio, a USB (UVC) webcam.            config: cameras.standard
 *   wide      Canon M50 for the 0.5 / High Angle shot.      config: cameras.wide
 *             mode "usb":  Canon EOS Webcam Utility (Windows/macOS)
 *             mode "hdmi": M50 HDMI out -> USB capture card (Cam Link, generic UVC)
 *
 * Rules this module enforces:
 *  - A camera is found by its device LABEL, never by its position in the list.
 *    Labels are blank until the page has been granted a camera once, so
 *    permission is requested first, then the devices are listed.
 *  - The matched deviceId and label are saved (config/booth.config.local.json,
 *    this PC only). Next start: the saved deviceId first, then the label. If
 *    neither is there, a clear error ("Standard camera (Brio) not found") —
 *    never a silent switch to some other camera.
 *  - ONE camera stream open at a time. Opening one stops every track of the
 *    other first: the Brio and a capture card streaming together fight over
 *    USB bandwidth (black frames, "Hardware MFT ... lack of hardware
 *    resources" on Windows).
 *  - A capture is only allowed once the video fired 'playing' plus ~300 ms,
 *    so the first frame isn't black.
 *  - The Brio's PREVIEW is mirrored (selfie feel). The M50's isn't. Saved and
 *    printed images are never mirrored.
 *  - Stills come off the video at the stream's native size (videoWidth x
 *    videoHeight), not the on-screen size.
 *  - A stream that ends on its own (M50 auto power-off, a bumped cable) shows
 *    "Camera disconnected - reconnecting" and is retried every 2 s.
 */

/**
 * Everything the cameras do, timestamped, for the operator panel's "Copy
 * camera log" — so a problem on the booth PC can be read, not guessed at.
 */
export const cameraLog = [];
export function clog(msg) {
  const t = new Date();
  const line = `${t.toTimeString().slice(0, 8)}.${String(t.getMilliseconds()).padStart(3, '0')} ${msg}`;
  cameraLog.push(line);
  if (cameraLog.length > 300) cameraLog.shift();
  console.log(`[camera] ${msg}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Chromium's names for "the device exists but won't open" — almost always
// another app (or another stream in this one) already holding it.
const BUSY = ['NotReadableError', 'AbortError', 'TrackStartError'];

export const ROLES = ['standard', 'wide'];

/* ------------------------------------------------------------ config */

const DEFAULTS = {
  standard: {
    label: 'Standard', name: 'Standard camera (Brio)',
    labelMatch: ['Logitech BRIO', 'BRIO'], mirrorPreview: true,
  },
  wide: {
    label: 'High Angle', name: '0.5 camera (Canon M50)', mode: 'hdmi',
    labelMatch: { usb: ['EOS Webcam Utility'], hdmi: ['Cam Link', 'USB Video', 'USB3.0 Video', 'Capture'] },
    mirrorPreview: false,
  },
};

/** One role's settings from booth.config.json's cameras block, defaults filled in. */
export function roleConfig(appCfg, role) {
  const c = { ...DEFAULTS[role], ...(appCfg?.cameras?.[role] || {}) };
  const lm = c.labelMatch;
  const match = (Array.isArray(lm) ? lm : lm?.[c.mode] || []).filter(Boolean);
  return {
    role,
    ...c,
    match,
    exclude: appCfg?.camera?.excludeLabels || [],
    width: c.width || 1920,
    height: c.height || 1080,
    frameRate: c.frameRate || 30,
    mirrorPreview: c.mirrorPreview ?? role === 'standard',
    settleMs: appCfg?.camera?.settleMs ?? 300,
  };
}

/** The roles turned on in the config (enabled: false hides one), for the angle picker. */
export function cameraRoles(appCfg) {
  return ROLES.filter(r => appCfg?.cameras?.[r] && appCfg.cameras[r].enabled !== false).map(r => ({ id: r, ...roleConfig(appCfg, r) }));
}

/**
 * Which device is this role's camera? Only devices whose label matches the
 * role's labelMatch are candidates. Among those: the saved deviceId, then
 * the saved label, then the first labelMatch entry that matches (in order).
 * null when none matches: the caller shows "... not found".
 * @param {MediaDeviceInfo[]} devices
 * @param {ReturnType<typeof roleConfig>} rc
 * @param {string[]} [taken] deviceIds already matched to the other role
 */
export function matchDevice(devices, rc, taken = []) {
  const lower = s => String(s || '').toLowerCase();
  const rank = d => rc.match.findIndex(m => lower(d.label).includes(lower(m)));
  const candidates = devices.filter(d => d.kind === 'videoinput' && d.label &&
    !taken.includes(d.deviceId) &&
    !rc.exclude.some(x => lower(d.label).includes(lower(x))) &&
    rank(d) !== -1);
  if (!candidates.length) return null;
  const byId = rc.deviceId && candidates.find(d => d.deviceId === rc.deviceId);
  if (byId) return { device: byId, how: 'saved deviceId' };
  const byLabel = rc.deviceLabel && candidates.find(d => d.label === rc.deviceLabel);
  if (byLabel) return { device: byLabel, how: 'saved label' };
  const best = [...candidates].sort((a, b) => rank(a) - rank(b))[0];
  return { device: best, how: `label match "${rc.match[rank(best)]}"` };
}

/* ----------------------------------------------------------- devices */

let permission = null;

/**
 * Labels come back empty until this page has been granted camera access
 * once. So: ask for any camera, close it straight away, then enumerate.
 * Skipped while a camera is already open (the grant exists, and opening the
 * default camera again would disturb the one streaming).
 */
async function requestPermission() {
  if (activeCamera?.stream) return;
  try {
    clog('permission: getUserMedia(any camera) to read device names');
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    s.getTracks().forEach(t => { clog(`permission: track.stop() "${t.label}"`); t.stop(); });
  } catch (e) {
    clog(`camera permission request: ${e.name}: ${e.message}`);
  }
}

/** Every video input, with labels. */
export async function listVideoDevices() {
  if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
    throw new Error('Camera access is unavailable in this window. Open the booth from Electron or a local web server.');
  }
  await (permission ||= requestPermission());
  const video = async () => (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  let devices = await video();
  if (devices.length && devices.some(d => !d.label)) {
    // Permission was lost (or never granted): ask again, once.
    await requestPermission();
    devices = await video();
  }
  clog(`devices: ${devices.map(d => `"${d.label || '?'}"`).join(', ') || 'none'}`);
  return devices;
}

/** Each role's matched device (or null), for the angle picker and diagnostics. */
export async function matchRoles(appCfg, devices = null) {
  devices ||= await listVideoDevices();
  const out = {};
  const taken = [];
  for (const r of cameraRoles(appCfg)) {
    const m = matchDevice(devices, r, taken);
    if (m) taken.push(m.device.deviceId);
    out[r.id] = m;
  }
  return { devices, matches: out };
}

/* ------------------------------------------------------------ stream */

/** The one camera with a stream open. */
let activeCamera = null;

export class Camera {
  /**
   * @param {object} appCfg  the whole booth config
   * @param {'standard'|'wide'} role
   */
  constructor(appCfg, role = 'standard', { remember } = {}) {
    this.role = role;
    this.rc = roleConfig(appCfg, role);
    this.base = appCfg?.camera || {};
    this.remember = remember || ((r, d) => globalThis.window?.booth?.cameras?.remember?.(r, d));
    this.stream = null;
    this.deviceId = null;
    this.label = null;
    this.devices = [];
    this.video = null;
    this.ready = false;
    this.settings = null;
    this.onStatus = () => {};
    this._lost = false;
    this._wanted = false;
  }

  get name() { return this.rc.name; }

  _status(st) {
    clog(`${this.role} ${st.level}: ${st.message}`);
    this.onStatus(st);
  }

  /** Finds this role's camera and opens it. Throws "<name> not found" when it isn't plugged in. */
  async start(videoEl) {
    this.video = videoEl;
    this._wanted = true;
    this.devices = await listVideoDevices();
    const m = matchDevice(this.devices, this.rc);
    if (!m) {
      const e = new Error(`${this.rc.name} not found`);
      e.code = 'CAMERA_NOT_FOUND';
      clog(`${this.role}: no device label matches ${JSON.stringify(this.rc.match)}${this.rc.deviceLabel ? ` (saved: "${this.rc.deviceLabel}")` : ''}`);
      this._status({ level: 'error', message: e.message });
      throw e;
    }
    clog(`${this.role}: "${m.device.label}" (by ${m.how})`);
    if (m.device.deviceId !== this.rc.deviceId || m.device.label !== this.rc.deviceLabel) {
      this.rc.deviceId = m.device.deviceId;
      this.rc.deviceLabel = m.device.label;
      await Promise.resolve(this.remember(this.role, { deviceId: m.device.deviceId, label: m.device.label })).catch(() => {});
    }
    return this._open(m.device);
  }

  async _open(device) {
    if (!this._wanted) throw stopped(this.role);
    // One stream at a time: every track of the other camera stops first.
    if (activeCamera && activeCamera !== this) activeCamera.stop(`"${this.role}" is opening`);
    this._release('reopening');
    activeCamera = this;
    const rc = this.rc;
    const constraints = {
      audio: false,
      video: {
        deviceId: { exact: device.deviceId },
        // ideal, not exact: EOS Webcam Utility often gives less than 1080p, and
        // that's fine — take what it returns and log it.
        width: { ideal: rc.width },
        height: { ideal: rc.height },
        frameRate: { ideal: rc.frameRate },
      },
    };
    clog(`${this.role}: open "${device.label}" asking ${rc.width}x${rc.height}@${rc.frameRate}`);
    try {
      this.stream = await openWithRetry(constraints, 4, this.role);
    } catch (error) {
      if (activeCamera === this) activeCamera = null;
      if (BUSY.includes(error.name)) {
        const holders = await globalThis.window?.booth?.app?.cameraHolders?.().catch(() => []) || [];
        throw new Error(holders.length
          ? `${rc.name} is busy — close ${holders.join(', ')}`
          : `${rc.name} is busy — another program has it open (quit Canon EOS Utility, OBS, Zoom/Teams, the Camera app)`);
      }
      if (['NotFoundError', 'OverconstrainedError'].includes(error.name)) {
        const e = new Error(`${rc.name} not found`);
        e.code = 'CAMERA_NOT_FOUND';
        throw e;
      }
      throw error;
    }
    // stop() was called while the camera was opening (e.g. the other
    // button was pressed): close this stream now, or it would keep running
    // unseen and hold the camera.
    if (!this._wanted || (activeCamera && activeCamera !== this)) {
      this._release('stopped while opening');
      throw stopped(this.role);
    }
    this.deviceId = device.deviceId;
    this.label = device.label;

    const track = this.stream.getVideoTracks()[0];
    this._lost = false;
    track.addEventListener('mute', () => clog(`${this.role}: track muted (no frames from "${track.label}")`));
    track.addEventListener('unmute', () => clog(`${this.role}: track unmuted`));
    track.addEventListener('ended', () => {
      clog(`${this.role}: track ended by the device ("${track.label}")`);
      if (this.stream?.getVideoTracks()[0] !== track) return; // already replaced
      this._lost = true;
      this.ready = false;
      this._status({ level: 'warn', message: 'Camera disconnected - reconnecting' });
      this._reconnect();
    });

    if (this.video) await this.attach(this.video);
    const s = this.settings = track.getSettings();
    clog(`${this.role}: "${track.label}" asked ${rc.width}x${rc.height}@${rc.frameRate}, got ${s.width}x${s.height}@${Math.round(s.frameRate || 0)} (video element ${this.video?.videoWidth}x${this.video?.videoHeight})`);
    this._status({ level: 'ok', message: `${track.label} — ${s.width}x${s.height} @ ${Math.round(s.frameRate || 0)}fps`, settings: s });
    return s;
  }

  /**
   * Shows the open stream in a <video>, mirrored for the Brio only, and
   * resolves once it's playing plus settleMs (capture is allowed after that).
   */
  async attach(videoEl) {
    this.video = videoEl;
    this.ready = false;
    videoEl.srcObject = this.stream;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.style.transform = this.rc?.mirrorPreview ? 'scaleX(-1)' : 'none';
    const playing = new Promise(res => {
      if (!videoEl.paused && videoEl.readyState >= 3) return res(true);
      videoEl.addEventListener('playing', () => res(true), { once: true });
    });
    videoEl.play().catch(e => clog(`${this.role}: video.play() failed: ${e.name}: ${e.message}`));
    const ok = await Promise.race([playing, sleep(10000).then(() => false)]);
    if (!ok) clog(`warn: ${this.role}: video never fired 'playing' in 10 s`);
    await sleep(this.rc?.settleMs ?? 300);
    this.ready = ok && !!videoEl.videoWidth;
    this._watch?.();
  }

  /**
   * Some capture cards stall instead of disconnecting: the track stays
   * "live", no 'ended' fires, and the picture just freezes. Reconnect if no
   * new frame is decoded for 4 s while the preview is on screen.
   */
  _watch() {
    clearInterval(this._watchdog);
    const v = this.video;
    if (!v?.getVideoPlaybackQuality || this.base.watchdog === false) return;
    let lastCount = v.getVideoPlaybackQuality().totalVideoFrames, at = performance.now();
    this._watchdog = setInterval(() => {
      if (!this._wanted || this.video !== v) return clearInterval(this._watchdog);
      if (this._reconnecting) return;
      const now = performance.now();
      const n = v.getVideoPlaybackQuality().totalVideoFrames;
      if (n !== lastCount || document.hidden || !v.isConnected || !v.getClientRects().length) { lastCount = n; at = now; return; }
      if (now - at > 4000) {
        clog(`${this.role}: picture froze — no new frames for ${((now - at) / 1000).toFixed(1)}s — reconnecting`);
        this._lost = true;
        this.ready = false;
        this._status({ level: 'warn', message: 'Camera disconnected - reconnecting' });
        this._release('picture froze');
        this._reconnect();
      }
    }, 1000);
  }

  /** Every 2 s until the camera is back (by saved deviceId, then label) or stop() is called. */
  async _reconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    try {
      for (let i = 1; this._wanted; i++) {
        await sleep(2000);
        if (!this._wanted) return;
        try {
          const m = matchDevice(await listVideoDevices(), this.rc);
          if (!m) { if (i % 5 === 1) this._status({ level: 'warn', message: 'Camera disconnected - reconnecting' }); continue; }
          await this._open(m.device);
          clog(`${this.role}: reconnected after ${i} attempt(s)`);
          return;
        } catch (e) { clog(`${this.role}: reconnect attempt ${i}: ${e.message}`); }
      }
    } finally {
      this._reconnecting = false;
    }
  }

  /** Waits (briefly) until a capture is allowed — e.g. while a dropped camera reconnects. */
  async waitReady(ms = 10000) {
    const t0 = Date.now();
    while (!(this.isLive && this.ready) && Date.now() - t0 < ms) await sleep(100);
    return this.isLive && this.ready;
  }

  _release(reason = '') {
    clearInterval(this._watchdog);
    this.stream?.getTracks().forEach(t => { clog(`${this.role}: track.stop() "${t.label}"${reason ? ` (${reason})` : ''}`); t.stop(); });
    this.stream = null;
    this.ready = false;
  }

  stop(reason = 'stop') {
    this._wanted = false;
    this._release(reason);
    if (activeCamera === this) activeCamera = null;
  }

  /**
   * One second after the preview starts: is it actually delivering frames?
   * Logs the track state and the video size, and throws a readable error
   * if there's no picture, so the screen never just stays blank.
   */
  async verifyLive(ms = 1000) {
    await sleep(ms);
    if (!this._wanted) throw stopped(this.role);
    const t = this.stream?.getVideoTracks()[0];
    const v = this.video;
    clog(`${this.role}: ${ms} ms after start: track ${t?.readyState || 'none'}${t?.muted ? ' (muted)' : ''}, video ${v?.videoWidth || 0}x${v?.videoHeight || 0}${v?.paused ? ', paused' : ''}`);
    if (!t || t.readyState !== 'live') throw new Error(`${this.rc.name}: the camera stopped right after starting`);
    if (!v?.videoWidth) throw new Error(`${this.rc.name}: no picture. The camera opened but sends no frames (check its cable and that no other app is using it)`);
  }

  get isLive() {
    return !!this.stream && !this._lost && this.stream.getVideoTracks()[0]?.readyState === 'live';
  }

  get resolution() {
    return { width: this.video?.videoWidth || 0, height: this.video?.videoHeight || 0 };
  }

  /* ------------------------------------------------------------ capture */

  /**
   * One frame at the stream's native resolution. Never mirrored: the preview
   * is mirrored for the customer, the print must read the right way round.
   */
  grab() {
    if (!this.video?.videoWidth) throw new Error('Camera not ready');
    const w = this.video.videoWidth, h = this.video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(this.video, 0, 0, w, h);
    return canvas;
  }

  /** Burst of frames for the GIF / boomerang, at native resolution x scale. */
  async burst({ frames = 12, intervalMs = 90, scale = 0.5 } = {}) {
    const out = [];
    const w = Math.round(this.video.videoWidth * scale);
    const h = Math.round(this.video.videoHeight * scale);
    for (let i = 0; i < frames; i++) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(this.video, 0, 0, w, h);
      out.push(c);
      if (i < frames - 1) await sleep(intervalMs);
    }
    return out;
  }
}

/** Stops whichever camera is streaming (leaving a screen, diagnostics). */
export function stopActiveCamera(reason = 'leaving the screen') {
  activeCamera?.stop(reason);
}

/** The error a camera's start() throws when stop() was called while it was still opening. */
function stopped(role) {
  const e = new Error(`${role}: stopped while opening`);
  e.code = 'CAMERA_STOPPED';
  return e;
}

/**
 * Applies a camera-look filter (from booth.config.json's filters.list) to an
 * already-captured photo, returning a new canvas — source is left untouched.
 * Non-destructive on purpose: the filter is chosen *after* the shoot, on the
 * actual photos, so picking "Original" (a falsy/none filter) just means every
 * caller re-derives from the same untouched S.shots instead of a baked-in one.
 */
export function applyPhotoFilter(source, filter) {
  const out = document.createElement('canvas');
  out.width = source.width; out.height = source.height;
  const ctx = out.getContext('2d');
  ctx.filter = filter?.cssFilter || 'none';
  ctx.drawImage(source, 0, 0);
  ctx.filter = 'none';
  applyFilterExtras(out, filter);
  return out;
}

/** A CSS filter() string alone can't do grain, so this is the manual part of
 *  a "vintage film" look: a tileable noise pattern generated once and reused
 *  (cheap enough not to matter for an occasional photo, expensive to redo
 *  per-pixel on every shot) plus a radial vignette, both optional per filter. */
let _noiseTile = null;
function noiseTile(size = 160) {
  if (_noiseTile) return _noiseTile;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  _noiseTile = c;
  return c;
}

function applyFilterExtras(canvas, filter) {
  if (!filter) return;
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  if (filter.vignette) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${filter.vignette})`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  if (filter.grain) {
    ctx.save();
    ctx.globalAlpha = filter.grain;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = ctx.createPattern(noiseTile(), 'repeat');
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

/**
 * Windows releases a camera a beat after the track stops, so opening it right
 * after something else closed it can fail as "busy". Give it a few tries.
 */
async function openWithRetry(constraints, tries = 4, who = '') {
  for (let i = 1; ; i++) {
    try {
      clog(`${who}: getUserMedia(deviceId ${String(constraints.video?.deviceId?.exact || 'any').slice(0, 10)}…) try ${i}`);
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      clog(`${who}: getUserMedia failed (try ${i}/${tries}): ${error.name}: ${error.message}`);
      if (!BUSY.includes(error.name) || i >= tries) throw error;
      await new Promise(r => setTimeout(r, 600 * i));
    }
  }
}

/* ================================================================ stills */

const jpegBlob = b64 => new Blob([Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))], { type: 'image/jpeg' });

/**
 * A tethered camera (camera.stills): the camera itself focuses, fires the
 * shutter and the flash, and hands back its full-resolution JPEG. Driven by
 * the main process over USB (electron/stills.js); this side only sees frames.
 *
 * Same surface as Camera — start/attach/stop/isLive/grab/burst — so the shoot
 * screen, the angle picker and the GIF burst work unchanged, plus shoot() for
 * the real photo. The live view is painted onto a canvas and fed to the
 * preview <video> as a stream, so everything that reads that <video> still
 * works, and every pixel stays same-origin (printable, uploadable).
 *
 * preview: "liveview" (default) uses the camera's own live view over the same
 * USB cable. "video" shows a capture card's HDMI feed instead (smoother) and
 * still takes the photos over USB.
 */
export class StillsCamera {
  constructor(appCfg = {}, role = 'standard', api = globalThis.window?.booth?.stills) {
    const st = appCfg.camera?.stills || {};
    this.api = api;
    this.role = role;
    this.rc = roleConfig(appCfg, role);
    this.cfg = {
      fps: st.liveviewFps || 12,
      maxDimension: st.maxDimension || 3000,
    };
    this.previewCam = st.preview === 'video' ? new Camera(appCfg, role) : null;
    this.stills = true;
    this.devices = [];
    this.video = null;
    this.stream = null;
    this.onStatus = () => {};
    this._running = false;
    this._paused = false;
    this._lastFrameAt = 0;
    this._lastError = '';
    this._gen = 0;
  }

  _status(st) {
    clog(`${st.level}: ${st.message}`);
    this.onStatus(st);
  }

  async start(videoEl) {
    if (!this.api) throw new Error('Tethered camera isn\'t available on this platform (camera.stills).');
    const st = await this.api.status();
    if (!st?.ok) throw new Error(st?.error || 'Tethered camera not ready');

    if (this.previewCam) {
      this.previewCam.onStatus = s => this._status(s.level === 'ok' ? { ...s, message: `${st.message} — photos over USB, preview: ${s.message}` } : s);
      await this.previewCam.start(videoEl);
      this.video = videoEl;
      this.stream = this.previewCam.stream;
      return this.previewCam.resolution;
    }

    this.stop();
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this._running = true;
    this._lastFrameAt = 0;
    this._loop();
    const t0 = Date.now();
    while (!this._lastFrameAt) {
      if (Date.now() - t0 > 10000) {
        this.stop();
        throw new Error(`No live view from the camera${this._lastError ? ` — ${this._lastError}` : ''}`);
      }
      await sleep(100);
    }
    // Created after the first frame, so the stream starts at the live view's real size.
    if (activeCamera && activeCamera !== this) activeCamera.stop();
    this.stream = this.canvas.captureStream(this.cfg.fps);
    await this.attach(videoEl);
    this._status({ level: 'ok', message: `${st.message} — live view ${this.canvas.width}x${this.canvas.height}, photos at full resolution with flash` });
    return this.resolution;
  }

  async _loop() {
    // A generation, so a loop still awaiting a frame from before stop() exits
    // instead of running alongside the one a restart begins.
    const gen = ++this._gen;
    const alive = () => this._running && gen === this._gen;
    let fails = 0;
    while (alive()) {
      const t = performance.now();
      if (!this._paused) {
        const r = await this.api.liveview().catch(e => ({ ok: false, error: e.message }));
        if (!alive()) break;
        if (r?.ok && r.jpeg) {
          try {
            const bmp = await createImageBitmap(jpegBlob(r.jpeg));
            if (this.canvas.width !== bmp.width || this.canvas.height !== bmp.height) {
              this.canvas.width = bmp.width; this.canvas.height = bmp.height;
            }
            this.ctx.drawImage(bmp, 0, 0);
            bmp.close();
            this._lastFrameAt = Date.now();
            fails = 0;
          } catch { /* a torn frame — skip it */ }
        } else if (r && !r.ok) {
          this._lastError = r.error;
          if (++fails === 15) this._status({ level: 'error', message: `Camera live view lost: ${r.error}` });
          await sleep(Math.min(2000, 100 * fails));
        }
      }
      await sleep(Math.max(0, 1000 / this.cfg.fps - (performance.now() - t)));
    }
  }

  attach(videoEl) {
    if (this.previewCam) { this.video = videoEl; return this.previewCam.attach(videoEl); }
    return Camera.prototype.attach.call(this, videoEl);
  }

  /**
   * The real photo: autofocus, shutter, flash, full-res download. Live view
   * pauses meanwhile (the camera can't do both). Scaled to maxDimension so
   * four 24 MP shots don't each hold ~100 MB of canvas.
   */
  async shoot() {
    this._paused = true;
    try {
      const t0 = performance.now();
      const r = await this.api.capture();
      clog(r?.ok ? `photo taken in ${((performance.now() - t0) / 1000).toFixed(1)}s (${r.file})` : `photo failed: ${r?.error}`);
      if (!r?.ok) throw new Error(r?.error || 'capture failed');
      const bmp = await createImageBitmap(jpegBlob(r.jpeg), { imageOrientation: 'from-image' });
      const k = Math.min(1, this.cfg.maxDimension / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      return c;
    } finally {
      this._paused = false;
      this._shotAt = Date.now();
    }
  }

  grab(opts) { return Camera.prototype.grab.call(this, opts); }

  /** The GIF comes from live view; wait for it to resume after a shot, or every frame is the same stale one. */
  async burst(opts) {
    const t0 = Date.now();
    while (!this.previewCam && this._lastFrameAt <= (this._shotAt || 0) + 300 && Date.now() - t0 < 3000) await sleep(50);
    return Camera.prototype.burst.call(this, opts);
  }

  stop() {
    this._running = false;
    this._gen++;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.previewCam?.stop();
  }

  get isLive() {
    if (this.previewCam) return this.previewCam.isLive;
    return this._running && (this._paused || Date.now() - this._lastFrameAt < 5000);
  }

  get resolution() {
    if (this.previewCam) return this.previewCam.resolution;
    return { width: this.canvas?.width || 0, height: this.canvas?.height || 0 };
  }
}

