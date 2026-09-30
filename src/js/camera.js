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
    };
    this.stream = null;
    this.deviceId = null;
    this.devices = [];
    this.video = null;
    this.onStatus = () => {};
    this._lost = false;
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
    return this.devices;
  }

  /** Higher score = more likely to be the HDMI capture card. */
  score(device) {
    const label = (device.label || '').toLowerCase();
    if (this.cfg.excludeLabels.some(x => label.includes(x.toLowerCase()))) return -1000;
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
      this.onStatus({
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
    try {
      this.stream = await openWithRetry(constraints);
    } catch (error) {
      if (BUSY.includes(error.name)) {
        // Name the program holding it, if it's one we know (Windows).
        const holders = await globalThis.window?.booth?.app?.cameraHolders?.().catch(() => []) || [];
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
    track.addEventListener('ended', () => {
      if (this.stream?.getVideoTracks()[0] !== track) return; // already replaced
      this._lost = true;
      this.onStatus({ level: 'warn', message: 'Camera signal dropped — reconnecting…' });
      this._reconnect();
    });

    // Capture cards often output black for the first few frames while they
    // lock onto the HDMI signal. Waiting beats printing a black card.
    await new Promise(r => setTimeout(r, this.cfg.warmupMs));

    const s = track.getSettings();
    this.onStatus({
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
    if (!v?.requestVideoFrameCallback) return;
    let last = performance.now();
    const tick = () => { last = performance.now(); if (this.video === v && this._wanted) v.requestVideoFrameCallback(tick); };
    v.requestVideoFrameCallback(tick);
    this._watchdog = setInterval(() => {
      if (!this._wanted || this.video !== v) return clearInterval(this._watchdog);
      if (this._reconnecting) return;
      if (document.hidden || !v.isConnected || !v.getClientRects().length) { last = performance.now(); return; }
      if (performance.now() - last > 4000) {
        console.warn('[camera] picture froze — reconnecting');
        this._lost = true;
        this.onStatus({ level: 'warn', message: 'Camera picture froze — reconnecting…' });
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
          console.warn(`[camera] reconnected after ${i + 1} attempt(s)`);
          return;
        } catch { /* still re-locking onto the signal */ }
      }
      if (this._wanted) this.onStatus({ level: 'error', message: 'Camera signal lost. Check the HDMI cable, and that the camera is on with auto power off and eco mode disabled.' });
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

  async start(videoEl) {
    if (!this.api) throw new Error('Tethered camera isn\'t available on this platform (camera.stills).');
    const st = await this.api.status();
    if (!st?.ok) throw new Error(st?.error || 'Tethered camera not ready');

    if (this.previewCam) {
      this.previewCam.onStatus = s => this.onStatus(s.level === 'ok' ? { ...s, message: `${st.message} — photos over USB, preview: ${s.message}` } : s);
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
    this.onStatus({ level: 'ok', message: `${st.message} — live view ${this.canvas.width}x${this.canvas.height}, photos at full resolution with flash` });
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
          if (++fails === 15) this.onStatus({ level: 'error', message: `Camera live view lost: ${r.error}` });
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
      const r = await this.api.capture();
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
