/**
 * camera.js — HDMI capture card handling.
 *
 * The trick that makes a real camera work in a photobooth: a capture card
 * (Elgato Cam Link, or any cheap generic UVC HDMI dongle) turns the camera's
 * clean HDMI output into a standard webcam. So there is no vendor SDK, no
 * gPhoto, no tethering library — just getUserMedia against the right device.
 *
 * What actually bites you in practice, and what this module handles:
 *  - Device labels are empty until a stream has been granted once, so you
 *    can't pick the right camera before asking for *a* camera.
 *  - The built-in laptop webcam is usually device #0, so naive code films the
 *    operator's face instead of the customer.
 *  - Capture cards need an explicit resolution request or Chromium settles for
 *    640x480, which looks fine on screen and terrible at 300dpi.
 *  - Unplugging HDMI mid-event kills the track silently; we watch and recover.
 */

/**
 * One permission probe for the whole page. Two Camera instances probing at
 * once (the angle picker starts one per angle) both open the default camera,
 * and on Windows that second open fails: "Hardware MFT failed to start
 * streaming due to lack of hardware resources".
 */
let probing = null;
async function probeOnce() {
  probing ||= navigator.mediaDevices.getUserMedia({ video: true })
    .then(s => s.getTracks().forEach(t => t.stop()), () => {})
    .finally(() => { probing = null; });
  return probing;
}

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

// Chromium's names for "the device exists but won't open" — almost always
// another app (or another stream in this one) already holding it.
const BUSY = ['NotReadableError', 'AbortError', 'TrackStartError'];

// Capture cards first. 'EOS Webcam' (Canon's EOS Webcam Utility, camera over USB) is last:
// once installed it lists a virtual camera even with nothing on USB, and would win with a blank picture.
const DEFAULT_PREFERRED = ['Cam Link', 'Elgato', 'HDMI', 'USB Video', 'USB3', 'UVC', 'Capture', 'EOS Webcam'];

export class Camera {
  constructor(config = {}) {
    this.cfg = {
      preferredLabels: config.preferredLabels || DEFAULT_PREFERRED,
      excludeLabels: config.excludeLabels || [],
      constraints: config.constraints || { width: 1920, height: 1080, frameRate: 30 },
      mirrorPreview: config.mirrorPreview !== false,
      warmupMs: config.warmupMs ?? 800,
      watchdog: config.watchdog !== false,
    };
    this.stream = null;
    this.deviceId = null;
    this.devices = [];
    this.video = null;
    this.onStatus = () => {};
    this._lost = false;
  }

  _status(st) {
    clog(`${st.level}: ${st.message}`);
    this.onStatus(st);
  }

  /* ------------------------------------------------------------ devices */

  /**
   * Enumerating before permission returns devices with blank labels, which
   * makes label matching impossible. Only then: take any camera, throw it
   * away, and enumerate again. Electron grants permission up front, so the
   * kiosk normally never opens a camera just to read its name.
   */
  async listDevices() {
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
      throw new Error('Camera access is unavailable in this window. Open the booth from Electron or a local web server.');
    }
    const video = async () => (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    let devices = await video();
    if (!devices.length || devices.some(d => !d.label)) {
      await probeOnce();
      devices = await video();
    }
    this.devices = devices;
    // OBS's Virtual Camera exists as a device even when OBS is closed, and
    // then shows only a placeholder. Only let it be picked while OBS runs.
    const holders = await globalThis.window?.booth?.app?.cameraHolders?.().catch(() => null);
    this._obsRunning = Array.isArray(holders) && holders.includes('OBS Studio');
    clog(`devices: ${devices.map(d => `"${d.label || '?'}"`).join(', ') || 'none'}${this._obsRunning ? ' (OBS running)' : ''}`);
    return this.devices;
  }

  /** Higher score = more likely to be the HDMI capture card. */
  score(device) {
    const label = (device.label || '').toLowerCase();
    if (this.cfg.excludeLabels.some(x => label.includes(x.toLowerCase()))) return -1000;
    if (label.includes('obs virtual camera') && !this._obsRunning) return -1000;
    const idx = this.cfg.preferredLabels.findIndex(x => label.includes(x.toLowerCase()));
    return idx === -1 ? 0 : 1000 - idx;
  }

  /** strict: return null instead of falling back to a camera that matches no preferred label. */
  async pickDevice(explicitId = null, { strict = false } = {}) {
    if (!this.devices.length) await this.listDevices();
    if (explicitId && this.devices.some(d => d.deviceId === explicitId)) return explicitId;
    const ranked = [...this.devices].sort((a, b) => this.score(b) - this.score(a));
    const best = ranked[0];
    if (strict) return best && this.score(best) > 0 ? best.deviceId : null;
    if (!best) {
      // The on-screen toast is brief and customer-facing — the operator
      // checking this needs the actual troubleshooting steps, which belong
      // in the console, not a 4-second banner.
      console.error(
        '[camera] No video input devices found. Check: the capture card/camera is ' +
        'plugged in; on Windows, Settings > Privacy & security > Camera has camera ' +
        'access AND "Let desktop apps access your camera" both turned on (Chromium ' +
        'can enumerate zero devices with either off, even with hardware connected); ' +
        'and no other app (OBS, Windows Camera, a leftover previous run of this app) ' +
        'already has the capture card open — most HDMI capture dongles only allow one ' +
        'app at a time.'
      );
      throw new Error('No video input devices found. Is the capture card plugged in? (See console for more.)');
    }
    if (this.score(best) <= 0) {
      this._status({
        level: 'warn',
        message: `No HDMI capture device matched. Falling back to "${best.label || 'unnamed camera'}". ` +
                 `Add part of its name to camera.preferredLabels in booth.config.json.`,
      });
    }
    return best.deviceId;
  }

  /* ------------------------------------------------------------- stream */

  async start(videoEl, explicitId = null) {
    this.video = videoEl;
    let useGenericStream = false;
    try {
      this.deviceId = await this.pickDevice(explicitId);
    } catch (error) {
      // Some Chromium kiosk builds can open a camera but hide its device list
      // until permission has settled. Let getUserMedia choose that camera.
      if (!/No video input devices found/.test(error.message)) throw error;
      useGenericStream = true;
      this.deviceId = null;
    }
    const c = this.cfg.constraints;

    // Ask for the exact device but only *ideal* geometry: a capture card that
    // can't do 1080p60 should downgrade, not fail outright.
    const constraints = {
      audio: false,
      video: {
        ...(useGenericStream ? {} : { deviceId: { exact: this.deviceId } }),
        width: { ideal: c.width },
        height: { ideal: c.height },
        frameRate: { ideal: c.frameRate },
        resizeMode: 'none',
      },
    };

    this._release();
    this._wanted = true;
    const picked = this.devices.find(d => d.deviceId === this.deviceId);
    clog(`open "${picked?.label || (useGenericStream ? 'default camera' : this.deviceId)}" asking ${c.width}x${c.height}@${c.frameRate}`);
    try {
      this.stream = await openWithRetry(constraints);
    } catch (error) {
      if (BUSY.includes(error.name)) {
        // Name the program holding it, if it's one we know (Windows).
        let holders = await globalThis.window?.booth?.app?.cameraHolders?.().catch(() => []) || [];
        // Opening OBS's own Virtual Camera: OBS running is the point, not the culprit.
        if (/obs virtual camera/i.test(picked?.label || '')) holders = holders.filter(h => h !== 'OBS Studio');
        console.error(
          `[camera] Can't open the camera (${error.name}: ${error.message}). ` +
          (holders.length ? `Running now and able to hold it: ${holders.join(', ')}. ` : '') +
          'Only one program can use a camera or capture card at a time: fully quit OBS (system ' +
          'tray → Exit), Lumabooth, the Windows Camera app, Zoom/Teams and EOS Webcam Utility, ' +
          'and check Task Manager for a leftover HoloBooth/Electron window. Then restart this app.'
        );
        throw new Error(holders.length
          ? `Camera is busy — close ${holders.join(', ')}`
          : 'Camera is busy — another program has it open (see console)');
      }
      // A stale deviceId is common after a capture card reconnects. Retry once
      // without pinning the request to the old device.
      if (!useGenericStream && ['NotFoundError', 'OverconstrainedError'].includes(error.name)) {
        this.deviceId = null;
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { width: { ideal: c.width }, height: { ideal: c.height }, frameRate: { ideal: c.frameRate } },
        });
      } else {
        throw error;
      }
    }
    await this.attach(videoEl);

    const track = this.stream.getVideoTracks()[0];
    this._lost = false;
    this._label = track.label;
    track.addEventListener('mute', () => clog(`track muted (no frames from "${track.label}")`));
    track.addEventListener('unmute', () => clog(`track unmuted ("${track.label}")`));
    track.addEventListener('ended', () => {
      clog(`track ended by the device ("${track.label}")`);
      if (this.stream?.getVideoTracks()[0] !== track) return; // already replaced
      this._lost = true;
      this._status({ level: 'warn', message: 'Camera signal dropped — reconnecting…' });
      this._reconnect();
    });

    // Capture cards often output black for the first few frames while they
    // lock onto the HDMI signal. Waiting beats printing a black card.
    await new Promise(r => setTimeout(r, this.cfg.warmupMs));

    const s = track.getSettings();
    this._status({
      level: 'ok',
      message: `${track.label} — ${s.width}x${s.height} @ ${Math.round(s.frameRate || 0)}fps`,
      settings: s,
    });
    return s;
  }

  /**
   * Shows the already-open stream in another <video>. Used to carry the
   * angle picker's live preview straight into the shoot: closing a camera
   * and reopening it a moment later is exactly when Windows reports it busy.
   */
  async attach(videoEl) {
    this.video = videoEl;
    videoEl.srcObject = this.stream;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.style.transform = this.cfg.mirrorPreview ? 'scaleX(-1)' : 'none';
    await videoEl.play().catch(() => {});
    this._watch?.();
  }

  /**
   * Some capture cards stall instead of disconnecting: the track stays
   * "live", no 'ended' fires, and the picture just freezes. Count frames
   * actually presented and reconnect if none arrive for 4 s while the
   * preview is on screen (hidden <video>s legitimately get no frames).
   */
  _watch() {
    clearInterval(this._watchdog);
    const v = this.video;
    if (!v?.requestVideoFrameCallback || !this.cfg.watchdog) return;
    let last = performance.now();
    const tick = () => { last = performance.now(); if (this.video === v && this._wanted) v.requestVideoFrameCallback(tick); };
    v.requestVideoFrameCallback(tick);
    // A second, independent frame counter. Only when BOTH say no new frames
    // is it a real freeze — one quiet signal alone (a window behind DevTools,
    // a driver quirk) mustn't make the booth drop a working camera.
    const decoded = () => v.getVideoPlaybackQuality?.().totalVideoFrames ?? null;
    let lastDecoded = decoded(), decodedAt = performance.now();
    this._watchdog = setInterval(() => {
      if (!this._wanted || this.video !== v) return clearInterval(this._watchdog);
      if (this._reconnecting) return;
      const now = performance.now();
      const d = decoded();
      if (d !== lastDecoded) { lastDecoded = d; decodedAt = now; }
      if (document.hidden || !v.isConnected || !v.getClientRects().length) { last = decodedAt = now; return; }
      const quietFor = Math.min(now - last, d === null ? Infinity : now - decodedAt);
      if (quietFor > 4000) {
        clog(`picture froze — no new frames for ${(quietFor / 1000).toFixed(1)}s ` +
          `(painted ${((now - last) / 1000).toFixed(1)}s ago, decoded count ${d} unchanged ${d === null ? 'n/a' : ((now - decodedAt) / 1000).toFixed(1) + 's'}, ` +
          `track ${this.stream?.getVideoTracks()[0]?.readyState}, muted ${this.stream?.getVideoTracks()[0]?.muted}) — reconnecting`);
        this._lost = true;
        this._status({ level: 'warn', message: 'Camera picture froze — reconnecting…' });
        this._release();
        this._reconnect();
      }
    }, 1000);
  }

  /**
   * Cheap HDMI capture cards drop off the USB bus for a moment whenever the
   * camera's HDMI signal changes (the M50 dimming its screen, a mode change,
   * a loose micro-HDMI plug). The card comes back a second later, often with
   * a new deviceId, so reopen by label instead of just reporting it dead.
   * Only the same device: while the card is gone, the next camera on the
   * list is often EOS Webcam Utility's virtual camera, which is blank.
   */
  async _reconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    const want = this._label;
    try {
      for (let i = 0; i < 30 && this._wanted; i++) {
        await sleep(1000);
        if (!this._wanted || !this.video) return; // stopped on purpose meanwhile
        try {
          this.devices = [];
          const same = (await this.listDevices()).find(d => d.label === want);
          if (!same) continue;
          await this.start(this.video, same.deviceId);
          clog(`reconnected after ${i + 1} attempt(s)`);
          return;
        } catch { /* still re-locking onto the signal */ }
      }
      if (this._wanted) this._status({ level: 'error', message: 'Camera signal lost. Check the HDMI cable, and that the camera is on with auto power off and eco mode disabled.' });
    } finally {
      this._reconnecting = false;
    }
  }

  /** Waits (briefly) for a live picture — e.g. while a dropped capture card reconnects. */
  async waitLive(ms = 10000) {
    const t0 = Date.now();
    while (!(this.isLive && this.video?.videoWidth) && Date.now() - t0 < ms) await sleep(100);
    return this.isLive;
  }

  _release() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  stop() {
    if (this.stream) clog(`stop (app closed "${this._label}")`);
    this._wanted = false;
    clearInterval(this._watchdog);
    this._release();
  }

  get isLive() {
    return !!this.stream && !this._lost && this.stream.getVideoTracks()[0]?.readyState === 'live';
  }

  get resolution() {
    const s = this.stream?.getVideoTracks()[0]?.getSettings();
    return s ? { width: s.width, height: s.height } : { width: 0, height: 0 };
  }

  /* ------------------------------------------------------------ capture */

  /**
   * Grab one full-resolution frame. Un-mirrors, because the preview is
   * mirrored for the customer's benefit but the print should read correctly
   * (otherwise every T-shirt slogan comes out backwards).
   */
  grab({ mirror = null } = {}) {
    if (!this.video || !this.video.videoWidth) throw new Error('Camera not ready');
    const w = this.video.videoWidth, h = this.video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const flip = mirror === null ? false : mirror;
    if (flip) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(this.video, 0, 0, w, h);
    return canvas;
  }

  /** Burst of frames for the GIF / boomerang, at native resolution / 2. */
  async burst({ frames = 12, intervalMs = 90, scale = 0.5 } = {}) {
    const out = [];
    const w = Math.round(this.video.videoWidth * scale);
    const h = Math.round(this.video.videoHeight * scale);
    for (let i = 0; i < frames; i++) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(this.video, 0, 0, w, h);
      out.push(c);
      if (i < frames - 1) await new Promise(r => setTimeout(r, intervalMs));
    }
    return out;
  }

  /**
   * Centre-crop a landscape 16:9 frame to the card's portrait window.
   * Doing this at capture time (not render time) keeps the print master
   * pixel-for-pixel — no double resampling.
   */
  static cropToAspect(source, aspect = 2.5 / 3.5, focal = { x: 0.5, y: 0.42 }) {
    const sw = source.width, sh = source.height;
    let cw = sw, ch = sw / aspect;
    if (ch > sh) { ch = sh; cw = sh * aspect; }
    const sx = Math.max(0, Math.min(sw - cw, (sw - cw) * focal.x));
    const sy = Math.max(0, Math.min(sh - ch, (sh - ch) * focal.y));
    const out = document.createElement('canvas');
    out.width = Math.round(cw); out.height = Math.round(ch);
    out.getContext('2d').drawImage(source, sx, sy, cw, ch, 0, 0, out.width, out.height);
    return out;
  }
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
async function openWithRetry(constraints, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      clog(`getUserMedia failed (try ${i}/${tries}): ${error.name}: ${error.message}`);
      if (!BUSY.includes(error.name) || i >= tries) throw error;
      await new Promise(r => setTimeout(r, 600 * i));
    }
  }
}

/* ================================================================ stills */

const sleep = ms => new Promise(r => setTimeout(r, ms));
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
  constructor(config = {}, api = globalThis.window?.booth?.stills) {
    const st = config.stills || {};
    this.api = api;
    this.cfg = {
      mirrorPreview: config.mirrorPreview !== false,
      fps: st.liveviewFps || 12,
      maxDimension: st.maxDimension || 3000,
      warmupMs: config.warmupMs ?? 800,
    };
    this.previewCam = st.preview === 'video' ? new Camera(config) : null;
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

/* ============================================================ OBS split */

/**
 * Two cameras through ONE device. OBS holds both capture cards and puts them
 * side by side in a single scene (3840x1080: camera 1 left, camera 2 right);
 * OBS Virtual Camera sends that one picture. Opening two capture cards at
 * once is exactly what failed on the booth PC (the second open killed the
 * first), and OBS Virtual Camera can only output one scene — so: one stream,
 * cut into regions here.
 *
 * ObsSplitSource opens OBS Virtual Camera once and is shared (ref-counted);
 * each SplitCamera shows one region in its own <video>, with the same surface
 * as Camera, so the angle picker, the shoot and the GIF work unchanged.
 */
export class ObsSplitSource {
  constructor(config = {}) {
    const sp = config.obsSplit || {};
    this.layout = sp.layout === 'stacked' ? 'stacked' : 'side-by-side';
    this.regions = sp.regions || 2;
    this.cam = new Camera({
      ...config,
      preferredLabels: [sp.deviceLabel || 'OBS Virtual Camera'],
      excludeLabels: [],
      constraints: {
        width: sp.width || (this.layout === 'stacked' ? 1920 : 1920 * this.regions),
        height: sp.height || (this.layout === 'stacked' ? 1080 * this.regions : 1080),
        frameRate: sp.frameRate || 30,
      },
      // The source <video> is off-screen, so the on-screen freeze check doesn't apply;
      // a dropped device still reconnects through the track's 'ended' event.
      watchdog: false,
    });
    this.cam.onStatus = st => this.onStatus?.(st);
    this.users = 0;
    this._opening = null;
  }

  get video() { return this.cam.video; }
  get isLive() { return this.cam.isLive && !!this.cam.video?.videoWidth; }

  /** The rectangle of the source frame that region i occupies. */
  rect(i) {
    const v = this.cam.video, W = v.videoWidth, H = v.videoHeight, n = this.regions;
    return this.layout === 'stacked'
      ? { sx: 0, sy: Math.round(i * H / n), sw: W, sh: Math.round(H / n) }
      : { sx: Math.round(i * W / n), sy: 0, sw: Math.round(W / n), sh: H };
  }

  async acquire() {
    this.users++;
    if (this.isLive) return;
    try {
      await (this._opening ||= this._open().finally(() => { this._opening = null; }));
    } catch (e) {
      this.users--;
      throw e;
    }
  }

  async _open() {
    const id = await this.cam.pickDevice(null, { strict: true }).catch(() => null);
    if (!id) {
      this.cam.devices = [];
      throw new Error('OBS Virtual Camera not available — start OBS and click Start Virtual Camera');
    }
    let v = this._el;
    if (!v) {
      v = this._el = document.createElement('video');
      v.muted = true; v.playsInline = true; v.autoplay = true;
      // Off-screen but in the page, so Chromium keeps decoding it.
      v.style.cssText = 'position:fixed;left:-10000px;top:0;width:64px;height:36px;pointer-events:none';
      document.body.appendChild(v);
    }
    const st = await this.cam.start(v, id);
    const ratio = st.width / st.height;
    const want = this.layout === 'stacked' ? 16 / 9 / this.regions : 16 / 9 * this.regions;
    clog(`obs split: source ${st.width}x${st.height}, ${this.layout}, ${this.regions} regions of ${Math.round(this.rect(0).sw)}x${Math.round(this.rect(0).sh)}`);
    if (Math.abs(ratio - want) / want > 0.15) {
      clog(`warn: OBS Virtual Camera is ${st.width}x${st.height}, not ${this.layout === 'stacked' ? '1920x2160' : '3840x1080'} — ` +
        'each camera will look squeezed. In OBS: Settings → Video, set Base and Output resolution to 3840x1080, ' +
        'and put the two cameras side by side, 1920x1080 each.');
    }
  }

  release() {
    this.users = Math.max(0, this.users - 1);
    if (!this.users) this.cam.stop();
  }
}

export class SplitCamera {
  constructor(source, region, config = {}) {
    this.source = source;
    this.region = region;
    this.split = true;
    this.cfg = { mirrorPreview: config.mirrorPreview !== false, warmupMs: config.warmupMs ?? 800, fps: config.obsSplit?.frameRate || 30 };
    this.devices = [];
    this.video = null;
    this.stream = null;
    this.onStatus = () => {};
    this._held = false;
    this._running = false;
  }

  _status(st) { clog(`${st.level}: ${st.message}`); this.onStatus(st); }

  async start(videoEl) {
    this.stop();
    await this.source.acquire();
    this._held = true;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this._running = true;
    this._drawn = false;
    this._draw();
    const t0 = Date.now();
    while (!this._drawn) {
      if (Date.now() - t0 > 8000) { this.stop(); throw new Error('No picture from OBS Virtual Camera'); }
      await new Promise(r => setTimeout(r, 50));
    }
    this.stream = this.canvas.captureStream(this.cfg.fps);
    await this.attach(videoEl);
    const r = this.source.rect(this.region);
    this._status({ level: 'ok', message: `OBS Virtual Camera — camera ${this.region + 1} (${r.sw}x${r.sh})` });
    return this.resolution;
  }

  _draw() {
    const gen = this._gen = (this._gen || 0) + 1;
    const step = () => {
      if (!this._running || gen !== this._gen) return;
      const v = this.source.video;
      if (v?.videoWidth) {
        const { sx, sy, sw, sh } = this.source.rect(this.region);
        if (this.canvas.width !== sw || this.canvas.height !== sh) { this.canvas.width = sw; this.canvas.height = sh; }
        this.ctx.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
        this._drawn = true;
      }
      setTimeout(step, 1000 / this.cfg.fps);
    };
    step();
  }

  attach(videoEl) { return Camera.prototype.attach.call(this, videoEl); }

  /** Straight off the region canvas — the newest frame, at full size. */
  grab({ mirror = false } = {}) {
    if (!this.canvas?.width || !this.source.isLive) throw new Error('Camera not ready');
    const c = document.createElement('canvas');
    c.width = this.canvas.width; c.height = this.canvas.height;
    const ctx = c.getContext('2d');
    if (mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(this.canvas, 0, 0);
    return c;
  }

  burst(opts) { return Camera.prototype.burst.call(this, opts); }

  async waitLive(ms = 10000) {
    const t0 = Date.now();
    while (!this.isLive && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100));
    return this.isLive;
  }

  stop() {
    this._running = false;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    if (this._held) { this._held = false; this.source.release(); }
  }

  get isLive() { return this._running && this.source.isLive; }
  get resolution() { return { width: this.canvas?.width || 0, height: this.canvas?.height || 0 }; }
}
