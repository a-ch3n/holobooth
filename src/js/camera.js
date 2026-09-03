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

const DEFAULT_PREFERRED = ['Cam Link', 'Elgato', 'HDMI', 'USB Video', 'UVC', 'Capture'];

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
   * makes label matching impossible. So: take any camera, throw it away, then
   * enumerate for real.
   */
  async listDevices() {
    let probe = null;
    try {
      probe = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch { /* no camera at all — still worth enumerating */ }
    const all = await navigator.mediaDevices.enumerateDevices();
    probe?.getTracks().forEach(t => t.stop());
    this.devices = all.filter(d => d.kind === 'videoinput');
    return this.devices;
  }

  /** Higher score = more likely to be the HDMI capture card. */
  score(device) {
    const label = (device.label || '').toLowerCase();
    if (this.cfg.excludeLabels.some(x => label.includes(x.toLowerCase()))) return -1000;
    const idx = this.cfg.preferredLabels.findIndex(x => label.includes(x.toLowerCase()));
    return idx === -1 ? 0 : 1000 - idx;
  }

  async pickDevice(explicitId = null) {
    if (!this.devices.length) await this.listDevices();
    if (explicitId && this.devices.some(d => d.deviceId === explicitId)) return explicitId;
    const ranked = [...this.devices].sort((a, b) => this.score(b) - this.score(a));
    const best = ranked[0];
    if (!best) throw new Error('No video input devices found. Is the capture card plugged in?');
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
    this.deviceId = await this.pickDevice(explicitId);
    const c = this.cfg.constraints;

    // Ask for the exact device but only *ideal* geometry: a capture card that
    // can't do 1080p60 should downgrade, not fail outright.
    const constraints = {
      audio: false,
      video: {
        deviceId: { exact: this.deviceId },
        width: { ideal: c.width },
        height: { ideal: c.height },
        frameRate: { ideal: c.frameRate },
        resizeMode: 'none',
      },
    };

    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = this.stream;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.style.transform = this.cfg.mirrorPreview ? 'scaleX(-1)' : 'none';
    await videoEl.play().catch(() => {});

    const track = this.stream.getVideoTracks()[0];
    this._lost = false;
    track.addEventListener('ended', () => {
      this._lost = true;
      this.onStatus({ level: 'error', message: 'Camera signal lost. Check the HDMI cable and that the camera is awake.' });
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

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
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
