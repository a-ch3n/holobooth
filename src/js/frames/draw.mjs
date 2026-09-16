/**
 * draw.mjs — low-level canvas drawing helpers shared by every frame template.
 * Runs unchanged in the Electron renderer and in node (via node-canvas),
 * so the exact pixels you see on the kiosk are the pixels that print.
 */

export const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ paths */

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Notched "cut corner" rectangle — reads as sci-fi / arcade hardware. */
export function notchRect(ctx, x, y, w, h, n) {
  ctx.beginPath();
  ctx.moveTo(x + n, y);
  ctx.lineTo(x + w - n, y);
  ctx.lineTo(x + w, y + n);
  ctx.lineTo(x + w, y + h - n);
  ctx.lineTo(x + w - n, y + h);
  ctx.lineTo(x + n, y + h);
  ctx.lineTo(x, y + h - n);
  ctx.lineTo(x, y + n);
  ctx.closePath();
}

/** Scalloped cloud edge — the kawaii sticker outline. */
export function scallopRect(ctx, x, y, w, h, bumps = 9) {
  const per = w / bumps;
  const r = per / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + r);
  for (let i = 0; i < bumps; i++) ctx.arc(x + per * i + r, y + r, r, Math.PI, 0);
  const vb = Math.max(2, Math.round(h / per));
  const vper = h / vb;
  for (let i = 0; i < vb; i++) ctx.arc(x + w - vper / 2, y + vper * i + vper / 2, vper / 2, -Math.PI / 2, Math.PI / 2);
  for (let i = bumps - 1; i >= 0; i--) ctx.arc(x + per * i + r, y + h - r, r, 0, Math.PI);
  for (let i = vb - 1; i >= 0; i--) ctx.arc(x + vper / 2, y + vper * i + vper / 2, vper / 2, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
}

export function starPath(ctx, cx, cy, outer, inner = outer * 0.45, points = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = rot + (i * Math.PI) / points;
    i ? ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

export function heartPath(ctx, cx, cy, s) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.75);
  ctx.bezierCurveTo(cx - s * 1.3, cy - s * 0.2, cx - s * 0.45, cy - s * 1.05, cx, cy - s * 0.35);
  ctx.bezierCurveTo(cx + s * 0.45, cy - s * 1.05, cx + s * 1.3, cy - s * 0.2, cx, cy + s * 0.75);
  ctx.closePath();
}

/* ----------------------------------------------------------------- colour */

export function linGrad(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

export function radGrad(ctx, x, y, r0, r1, stops) {
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

export function shade(hex, amt) {
  const c = hex.replace('#', '');
  const n = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) + amt * 255);
  const g = clamp(((n >> 8) & 255) + amt * 255);
  const b = clamp((n & 255) + amt * 255);
  return `rgb(${r},${g},${b})`;
}

export function alpha(color, a) {
  const s = String(color).trim();
  // Accept rgb()/rgba() too: re-alpha-ing an already-converted colour is easy
  // to do by accident, and silently produced rgba(NaN,...) — an invisible fill.
  const m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const [r, g, b] = m[1].split(',').map(v => parseFloat(v));
    return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
  }
  const c = s.replace('#', '');
  const n = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  if (Number.isNaN(n)) return s;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* -------------------------------------------------------------- structure */

/** Metallic bevel: the thing that makes a flat rectangle read as a card frame. */
export function bevel(ctx, x, y, w, h, r, base, depth = 1) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = linGrad(ctx, x, y, x, y + h, [
    [0, shade(base, 0.22 * depth)],
    [0.14, shade(base, 0.05 * depth)],
    [0.5, base],
    [0.86, shade(base, -0.14 * depth)],
    [1, shade(base, -0.26 * depth)],
  ]);
  ctx.fill();
  ctx.clip();
  // top highlight
  ctx.globalAlpha = 0.5 * depth;
  ctx.strokeStyle = shade(base, 0.45);
  ctx.lineWidth = Math.max(1, h * 0.006);
  ctx.beginPath();
  ctx.moveTo(x, y + ctx.lineWidth / 2);
  ctx.lineTo(x + w, y + ctx.lineWidth / 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Inset well — used for art windows and text boxes so content sits "under" the frame. */
export function inset(ctx, x, y, w, h, r, strength = 0.5) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.strokeStyle = `rgba(0,0,0,${0.55 * strength})`;
  ctx.lineWidth = Math.max(2, h * 0.02);
  roundRect(ctx, x - ctx.lineWidth, y - ctx.lineWidth, w + ctx.lineWidth * 2, h + ctx.lineWidth * 1.2, r);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = `rgba(255,255,255,${0.35 * strength})`;
  ctx.lineWidth = Math.max(1, h * 0.006);
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------- text */

export function font(weight, size, family) {
  return `${weight} ${Math.round(size)}px ${family}`;
}

/** Draw text, shrinking the size until it fits maxW. Returns the size used. */
export function fitText(ctx, text, x, y, maxW, size, weight, family, align = 'left') {
  ctx.save();
  let s = size;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  do {
    ctx.font = font(weight, s, family);
    if (ctx.measureText(text).width <= maxW || s <= 8) break;
    s -= 1;
  } while (true);
  ctx.fillText(text, x, y);
  ctx.restore();
  return s;
}

/** Word-wrapped paragraph. Returns the y after the last line. */
export function paragraph(ctx, text, x, y, maxW, size, lineH, weight, family, maxLines = 99) {
  ctx.save();
  ctx.font = font(weight, size, family);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const words = String(text).split(/\s+/);
  let line = '';
  let ly = y;
  let lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      if (++lines >= maxLines) { ctx.fillText(line + '…', x, ly); ctx.restore(); return ly + lineH; }
      ctx.fillText(line, x, ly);
      ly += lineH;
      line = words[i];
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, ly); ly += lineH; }
  ctx.restore();
  return ly;
}

/** Height a paragraph() call would occupy, without drawing it. */
export function measureParagraph(ctx, text, maxW, size, lineH, weight, family, maxLines = 99) {
  ctx.save();
  ctx.font = font(weight, size, family);
  const words = String(text).split(/\s+/);
  let line = '', lines = 1;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      if (lines >= maxLines) break;
      lines++;
      line = words[i];
    } else line = test;
  }
  ctx.restore();
  return Math.min(lines, maxLines) * lineH;
}

export function outlinedText(ctx, text, x, y, size, weight, family, fill, stroke, strokeW, align = 'center') {
  ctx.save();
  ctx.font = font(weight, size, family);
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeW;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/* --------------------------------------------------------------- textures */

/**
 * Scratch-canvas factory. The browser has one built in; node-canvas has to
 * hand us theirs. Set once at startup (see tools/render-all.mjs).
 */
let scratchFactory = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  return null;
};
export function setCanvasFactory(fn) { scratchFactory = fn; }

/**
 * Deterministic film grain / cardstock tooth.
 *
 * Drawn through an offscreen canvas rather than putImageData, because
 * putImageData writes raw pixels — it ignores clipping regions AND alpha
 * compositing, so it would erase whatever the template already painted.
 * The noise is generated at 1/2 scale and upsampled: half the pixels, and the
 * slight blur reads more like paper than like TV static.
 */
export function grain(ctx, x, y, w, h, amount = 0.06, seed = 1) {
  const gw = Math.max(1, Math.ceil(w / 2));
  const gh = Math.max(1, Math.ceil(h / 2));
  const scratch = scratchFactory(gw, gh);
  if (!scratch) return;
  const sctx = scratch.getContext('2d');
  const img = sctx.createImageData(gw, gh);
  let s = (seed >>> 0) || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (rnd() - 0.5) * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v > 0 ? 255 : 0;
    img.data[i + 3] = Math.abs(v) * amount;
  }
  sctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.drawImage(scratch, x, y, w, h);
  ctx.restore();
}

/** Diagonal prismatic sweep — the holo look, tuned per rarity by callers. */
export function holoSweep(ctx, x, y, w, h, strength = 0.35, angle = 0.6, bands = 6) {
  ctx.save();
  const dx = Math.cos(angle) * w, dy = Math.sin(angle) * h;
  const g = ctx.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
  const hues = [190, 285, 330, 45, 120, 200];
  for (let i = 0; i <= bands; i++) {
    const t = i / bands;
    g.addColorStop(t, `hsla(${hues[i % hues.length]}, 95%, 66%, ${strength})`);
    if (i < bands) g.addColorStop(t + 0.5 / bands, `hsla(${hues[i % hues.length]}, 90%, 92%, ${strength * 0.25})`);
  }
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Fine linear ridges — the physical diffraction lines on real foil stock. */
export function foilLines(ctx, x, y, w, h, spacing = 4, strength = 0.1, angle = -0.5) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.globalCompositeOperation = 'overlay';
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(angle);
  ctx.strokeStyle = `rgba(255,255,255,${strength})`;
  ctx.lineWidth = 1;
  const span = Math.hypot(w, h);
  for (let i = -span; i < span; i += spacing) {
    ctx.beginPath(); ctx.moveTo(i, -span); ctx.lineTo(i, span); ctx.stroke();
  }
  ctx.restore();
}

/** CRT scanlines for the retro/arcade family. */
export function scanlines(ctx, x, y, w, h, spacing = 4, strength = 0.14) {
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${strength})`;
  for (let yy = y; yy < y + h; yy += spacing) ctx.fillRect(x, yy, w, Math.max(1, spacing / 2));
  ctx.restore();
}

/** Confetti of stars/hearts/sparkles for cute frames. Deterministic per seed. */
export function confetti(ctx, x, y, w, h, colors, count = 26, seed = 7, kinds = ['star', 'heart', 'dot']) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const cx = x + rnd() * w, cy = y + rnd() * h;
    const sz = (0.006 + rnd() * 0.016) * Math.max(w, h);
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    ctx.globalAlpha = 0.35 + rnd() * 0.55;
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    if (kind === 'star') starPath(ctx, cx, cy, sz, sz * 0.42, 4 + (i % 2), rnd() * TAU);
    else if (kind === 'heart') heartPath(ctx, cx, cy, sz);
    else { ctx.beginPath(); ctx.arc(cx, cy, sz * 0.5, 0, TAU); }
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ image */

/**
 * Cover-fit an image into a rect (like CSS object-fit: cover), honouring a
 * focal point so faces stay centred when the photo is cropped hard.
 */
export function drawCover(ctx, img, x, y, w, h, focal = { x: 0.5, y: 0.5 }) {
  const iw = img.width, ih = img.height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale, dh = ih * scale;
  const dx = x + (w - dw) * focal.x;
  const dy = y + (h - dh) * focal.y;
  ctx.drawImage(img, dx, dy, dw, dh);
}

export function clipped(ctx, pathFn, drawFn) {
  ctx.save();
  pathFn(ctx);
  ctx.clip();
  drawFn(ctx);
  ctx.restore();
}

/** Soft drop shadow around a path without bleeding onto later draws. */
export function withShadow(ctx, color, blur, ox, oy, fn) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = ox;
  ctx.shadowOffsetY = oy;
  fn(ctx);
  ctx.restore();
}
