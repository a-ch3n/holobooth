/**
 * kit.mjs — the HoloBooth strip design system's drawing primitives.
 *
 * Everything is measured in physical units. A design asks for `u(0.12)` (an
 * eighth of an inch) or `pt(9)` (nine-point type), never raw pixels, so the
 * same design is correct on a 360px picker tile and a 300dpi print master,
 * and printed type can be checked against real minimums (nothing smaller
 * than 6pt reaches paper).
 *
 * Shapes that carry meaning — hearts, stars, sparkles, arrows, the date-stamp
 * digits — are drawn as paths, never glyphs, so they look identical on the
 * Mac proofing machine and the Windows kiosk regardless of installed fonts.
 */

import { roundRect, drawCover, grain } from '../draw.mjs';

export const TAU = Math.PI * 2;

/* ------------------------------------------------------------ type stacks */
/* Each stack leads with the macOS face the proofs were designed in, then the
   closest face Windows ships with, then a generic. Order matters. */
export const FONTS = {
  didot: 'Didot, "Bodoni 72", "Bodoni MT", "Didot LT STD", Constantia, Georgia, serif',
  serif: 'Baskerville, "Baskerville Old Face", "Palatino Linotype", Palatino, Georgia, serif',
  caslon: '"Big Caslon", "Hoefler Text", Constantia, Georgia, serif',
  sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  geo: 'Futura, "Century Gothic", "Avenir Next", Bahnschrift, "Trebuchet MS", sans-serif',
  avenir: '"Avenir Next", Avenir, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  condensed: '"DIN Condensed", "Avenir Next Condensed", "Bahnschrift Condensed", "Arial Narrow", Impact, sans-serif',
  din: '"DIN Alternate", Bahnschrift, "Avenir Next", "Segoe UI", Arial, sans-serif',
  impact: 'Impact, "Haettenschweiler", "Arial Black", sans-serif',
  black: '"Arial Black", "Helvetica Neue", Arial, sans-serif',
  script: '"Snell Roundhand", "Edwardian Script ITC", "Segoe Script", "Brush Script MT", cursive',
  hand: '"Bradley Hand", Noteworthy, "Segoe Print", "Ink Free", "Comic Sans MS", cursive',
  marker: '"Marker Felt", "Ink Free", "Segoe Print", "Comic Sans MS", cursive',
  type: '"American Typewriter", "Courier New", Courier, monospace',
  mono: 'Menlo, Consolas, "Courier New", monospace',
  round: '"Avenir Next Rounded", "Arial Rounded MT Bold", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif',
  korean: '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Segoe UI", sans-serif',
};

/* ------------------------------------------------------------------ units */

/** Unit helpers for a canvas whose physical width is `widthIn` inches. */
export function units(W, widthIn) {
  const ppi = W / widthIn;
  return { ppi, u: inch => inch * ppi, pt: points => (points / 72) * ppi };
}

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------- text */

/* Smallest type allowed on paper, in px for the canvas being drawn. The
   engine sets it to 6pt before each render; text() never shrinks below it
   and truncates with an ellipsis instead. */
let MIN_PX = 0;
export function setMinType(px) { MIN_PX = px; }

/**
 * Set a line of type. Shrinks to `maxW` (never below `minSize`), supports
 * tracking in em, alignment and an optional stroke. Returns { width, size }.
 */
export function text(ctx, str, x, y, o = {}) {
  const {
    size = 12, font = FONTS.sans, weight = 400, style = '', color = '#000',
    align = 'left', baseline = 'alphabetic', tracking = 0, maxW = Infinity,
    minSize = Math.max(size * 0.45, Math.min(size, MIN_PX)), stroke = null, strokeW = 0, alpha = 1, upper = false,
    shadow = null,
  } = o;
  if (str == null || str === '') return { width: 0, size };
  const s0 = upper ? String(str).toUpperCase() : String(str);
  ctx.save();
  let s = size;
  let str1 = s0;
  const setFont = () => {
    ctx.font = `${style ? style + ' ' : ''}${weight} ${Math.max(1, s).toFixed(1)}px ${font}`;
    ctx.letterSpacing = tracking ? `${(tracking * s).toFixed(2)}px` : '0px';
  };
  setFont();
  let w = ctx.measureText(str1).width;
  while (w > maxW && s * 0.94 >= minSize) { s *= 0.94; setFont(); w = ctx.measureText(str1).width; }
  // still too long at the floor: trim, never print microscopic type
  while (w > maxW && str1.length > 2) { str1 = str1.slice(0, -2).trimEnd() + '…'; w = ctx.measureText(str1).width; }
  // letterSpacing adds trailing space after the last glyph; correct centring
  const trail = tracking ? tracking * s : 0;
  const vis = w - trail;
  let dx = x;
  if (align === 'center') dx = x - vis / 2;
  else if (align === 'right') dx = x - vis;
  ctx.textAlign = 'left';
  ctx.textBaseline = baseline;
  ctx.globalAlpha *= alpha;
  if (shadow) { ctx.shadowColor = shadow.color; ctx.shadowBlur = shadow.blur || 0; ctx.shadowOffsetX = shadow.x || 0; ctx.shadowOffsetY = shadow.y || 0; }
  if (stroke && strokeW) {
    ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    ctx.strokeStyle = stroke; ctx.lineWidth = strokeW;
    ctx.strokeText(str1, dx, y);
    ctx.shadowColor = 'transparent';
  }
  ctx.fillStyle = color;
  ctx.fillText(str1, dx, y);
  ctx.restore();
  return { width: vis, size: s };
}

/** Word-wrapped lines (left/centre/right). Returns the y after the last line. */
export function wrap(ctx, str, x, y, maxW, lineH, o = {}, maxLines = 3) {
  const words = String(str).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (measure(ctx, t, o) > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown[maxLines - 1] += ' …';
  shown.forEach((l, i) => text(ctx, l, x, y + i * lineH, { ...o, maxW }));
  return y + shown.length * lineH;
}

/** Width a text() call would take, without drawing. */
export function measure(ctx, str, o = {}) {
  const { size = 12, font = FONTS.sans, weight = 400, style = '', tracking = 0, upper = false } = o;
  ctx.save();
  ctx.font = `${style ? style + ' ' : ''}${weight} ${size.toFixed(1)}px ${font}`;
  ctx.letterSpacing = tracking ? `${(tracking * size).toFixed(2)}px` : '0px';
  const w = ctx.measureText(upper ? String(str).toUpperCase() : String(str)).width - (tracking ? tracking * size : 0);
  ctx.restore();
  return w;
}

/** Text rotated 90° (reading bottom-to-top when dir = -1). */
export function vtext(ctx, str, x, y, dir, o) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dir * Math.PI / 2);
  const r = text(ctx, str, 0, 0, { ...o, baseline: o.baseline || 'middle' });
  ctx.restore();
  return r;
}

/* ----------------------------------------------------------------- photos */

/**
 * The photo window. Clips to `shape` (rect, round, arch or any path fn),
 * cover-fits the image at the given focal point and applies an optional tone.
 * A missing image draws a neutral "photo goes here" field rather than nothing,
 * so a layout can be judged with no camera attached.
 */
export function photo(ctx, img, s, o = {}) {
  const { r = 0, shape = 'rect', focal = { x: 0.5, y: 0.42 }, tone = null, fill = '#d8d6d2', inner = null } = o;
  ctx.save();
  if (s.rot) { ctx.translate(s.x + s.w / 2, s.y + s.h / 2); ctx.rotate(s.rot); ctx.translate(-(s.x + s.w / 2), -(s.y + s.h / 2)); }
  slotPath(ctx, s, shape, r);
  ctx.clip();
  ctx.fillStyle = fill;
  ctx.fillRect(s.x, s.y, s.w, s.h);
  if (img) {
    if (tone) ctx.filter = TONES[tone] || tone;
    drawCover(ctx, img, s.x, s.y, s.w, s.h, focal);
    ctx.filter = 'none';
    if (tone === 'warm' || tone === 'faded') {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = 'rgba(255,170,90,.22)';
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  if (inner) {
    // inner shadow, so the photo sits *in* the paper rather than on it
    ctx.shadowColor = inner; ctx.shadowBlur = Math.min(s.w, s.h) * 0.06;
    ctx.lineWidth = Math.min(s.w, s.h) * 0.04; ctx.strokeStyle = inner;
    slotPath(ctx, s, shape, r); ctx.stroke();
  }
  ctx.restore();
}

export const TONES = {
  mono: 'grayscale(1) contrast(1.12) brightness(1.03)',
  silver: 'grayscale(1) contrast(1.25) brightness(1.06)',
  warm: 'sepia(.22) saturate(1.12) contrast(1.04)',
  faded: 'sepia(.18) saturate(.86) contrast(.9) brightness(1.06)',
  cool: 'saturate(.9) hue-rotate(-8deg) brightness(1.04)',
  bright: 'saturate(1.18) brightness(1.06)',
  soft: 'saturate(.95) brightness(1.07) contrast(.95)',
};

export function slotPath(ctx, s, shape = 'rect', r = 0) {
  if (typeof shape === 'function') return shape(ctx, s);
  if (shape === 'arch') {
    const rr = Math.min(s.w / 2, s.h * 0.5);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y + s.h);
    ctx.lineTo(s.x, s.y + rr);
    ctx.arc(s.x + rr, s.y + rr, rr, Math.PI, Math.PI * 1.5);
    ctx.lineTo(s.x + s.w - rr, s.y);
    ctx.arc(s.x + s.w - rr, s.y + rr, rr, Math.PI * 1.5, TAU);
    ctx.lineTo(s.x + s.w, s.y + s.h);
    ctx.closePath();
    return;
  }
  if (shape === 'pill' ) return roundRect(ctx, s.x, s.y, s.w, s.h, Math.min(s.w, s.h) / 2);
  if (r) return roundRect(ctx, s.x, s.y, s.w, s.h, r);
  ctx.beginPath(); ctx.rect(s.x, s.y, s.w, s.h);
}

/* --------------------------------------------------------------- textures */

/** Paper tooth: fibres plus fine grain. Subtle enough to survive dye-sub. */
export function paper(ctx, x, y, w, h, seed = 3, o = {}) {
  const { fibres = 0.05, tooth = 0.035, dark = false } = o;
  const r = rng(seed);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.lineWidth = Math.max(0.6, w * 0.0012);
  const n = Math.round((w * h) / 2600);
  for (let i = 0; i < n; i++) {
    const px = x + r() * w, py = y + r() * h, len = (0.004 + r() * 0.02) * w, a = r() * TAU;
    ctx.strokeStyle = dark ? `rgba(255,255,255,${fibres * r()})` : `rgba(90,70,40,${fibres * r()})`;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); ctx.stroke();
  }
  ctx.restore();
  if (tooth) grain(ctx, x, y, w, h, tooth, seed + 11);
}

/** Film grain — heavier, uniform. */
export function filmGrain(ctx, x, y, w, h, amount = 0.07, seed = 9) {
  grain(ctx, x, y, w, h, amount, seed);
}

/** Halftone dot field fading along a direction. */
export function halftone(ctx, x, y, w, h, step, color, o = {}) {
  const { from = 0, to = 1, angle = 0.4, max = 0.48 } = o;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = color;
  for (let yy = y; yy < y + h + step; yy += step) {
    const odd = Math.round((yy - y) / step) % 2;
    for (let xx = x + (odd ? step / 2 : 0); xx < x + w + step; xx += step) {
      const t = ((yy - y) / h) * Math.cos(angle) + ((xx - x) / w) * Math.sin(angle);
      const k = Math.max(0, Math.min(1, (t - from) / (to - from)));
      const rr = step * max * k;
      if (rr > 0.3) { ctx.beginPath(); ctx.arc(xx, yy, rr, 0, TAU); ctx.fill(); }
    }
  }
  ctx.restore();
}

/** Brushed metal: dense horizontal streaks over a vertical chrome ramp. */
export function brushedMetal(ctx, x, y, w, h, stops, seed = 5) {
  ctx.save();
  ctx.fillStyle = lin(ctx, x, y, x, y + h, stops);
  ctx.fillRect(x, y, w, h);
  const r = rng(seed);
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  for (let i = 0; i < h / 1.4; i++) {
    const yy = y + r() * h;
    ctx.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.02 + r() * 0.05})` : `rgba(0,0,0,${0.02 + r() * 0.05})`;
    ctx.fillRect(x, yy, w, Math.max(1, r() * 2));
  }
  ctx.restore();
}

export function lin(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([t, c]) => g.addColorStop(t, c));
  return g;
}
export function rad(ctx, x, y, r0, r1, stops, x1 = x, y1 = y) {
  const g = ctx.createRadialGradient(x, y, r0, x1, y1, r1);
  stops.forEach(([t, c]) => g.addColorStop(t, c));
  return g;
}

/** Chrome ramp: horizon line, sky above, ground below. */
export function chromeStops(tint = '#9fb4d8') {
  return [[0, '#ffffff'], [0.22, '#dfe6f0'], [0.46, tint], [0.5, '#2a2f3a'], [0.56, '#5b6577'], [0.8, '#e9eef6'], [1, '#ffffff']];
}
export function holoStops(a = 0.9) {
  return [[0, `rgba(255,170,220,${a})`], [0.2, `rgba(170,200,255,${a})`], [0.42, `rgba(170,255,230,${a})`],
    [0.62, `rgba(255,250,180,${a})`], [0.82, `rgba(220,170,255,${a})`], [1, `rgba(255,170,220,${a})`]];
}

/* ---------------------------------------------------------------- shapes */

export function heart(ctx, cx, cy, s) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.32);
  ctx.bezierCurveTo(cx - s * 0.62, cy - s * 0.12, cx - s * 0.36, cy - s * 0.62, cx, cy - s * 0.26);
  ctx.bezierCurveTo(cx + s * 0.36, cy - s * 0.62, cx + s * 0.62, cy - s * 0.12, cx, cy + s * 0.32);
  ctx.closePath();
}

export function star(ctx, cx, cy, outer, inner = outer * 0.45, points = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = rot + (i * Math.PI) / points;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

/** Four-point twinkle with concave sides — the HoloBooth spark. */
export function sparkle(ctx, cx, cy, r, waist = 0.16) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + r * waist, cy - r * waist, cx + r, cy);
  ctx.quadraticCurveTo(cx + r * waist, cy + r * waist, cx, cy + r);
  ctx.quadraticCurveTo(cx - r * waist, cy + r * waist, cx - r, cy);
  ctx.quadraticCurveTo(cx - r * waist, cy - r * waist, cx, cy - r);
  ctx.closePath();
}

export function fillShape(ctx, pathFn, color) { pathFn(); ctx.fillStyle = color; ctx.fill(); }

/** A sprig of leaves along a curve — botanical without clip-art. */
export function sprig(ctx, x, y, len, ang, color, o = {}) {
  const { leaves = 7, size = len * 0.16, curve = 0.18, flip = 1, stem = len * 0.012 } = o;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = stem; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.5, -len * curve * flip, len, 0); ctx.stroke();
  for (let i = 1; i <= leaves; i++) {
    const t = i / (leaves + 0.6);
    const px = len * t, py = -len * curve * flip * 4 * t * (1 - t);
    const side = i % 2 ? 1 : -1;
    const s = size * (1 - t * 0.45);
    ctx.save(); ctx.translate(px, py); ctx.rotate(side * 0.75 - 0.15);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(s * 0.5, -s * 0.38 * side, s, 0);
    ctx.quadraticCurveTo(s * 0.5, s * 0.38 * side, 0, 0);
    ctx.fill(); ctx.restore();
  }
  // tip leaf
  ctx.save(); ctx.translate(len, 0);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(size * 0.5, -size * 0.3, size, 0); ctx.quadraticCurveTo(size * 0.5, size * 0.3, 0, 0); ctx.fill();
  ctx.restore();
  ctx.restore();
}

/** Translucent tape with torn ends. */
export function tape(ctx, cx, cy, w, h, rot, color, seed = 1) {
  const r = rng(seed);
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(rot);
  ctx.beginPath();
  const teeth = 6;
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  for (let i = 1; i <= teeth; i++) ctx.lineTo(w / 2 + (r() - 0.5) * h * 0.18, -h / 2 + (i / teeth) * h);
  ctx.lineTo(-w / 2, h / 2);
  for (let i = teeth - 1; i >= 0; i--) ctx.lineTo(-w / 2 + (r() - 0.5) * h * 0.18, -h / 2 + (i / teeth) * h);
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(-w / 2, -h / 2, w, h * 0.3);
  ctx.restore();
}

/** Torn-paper rectangle (rough edges on the listed sides). */
export function tornRect(ctx, x, y, w, h, seed, amp, sides = 'tblr') {
  const r = rng(seed);
  const step = amp * 1.6;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let xx = x; xx <= x + w; xx += step) ctx.lineTo(xx, y + (sides.includes('t') ? (r() - 0.3) * amp : 0));
  for (let yy = y; yy <= y + h; yy += step) ctx.lineTo(x + w + (sides.includes('r') ? (r() - 0.7) * amp : 0), yy);
  for (let xx = x + w; xx >= x; xx -= step) ctx.lineTo(xx, y + h + (sides.includes('b') ? (r() - 0.7) * amp : 0));
  for (let yy = y + h; yy >= y; yy -= step) ctx.lineTo(x + (sides.includes('l') ? (r() - 0.3) * amp : 0), yy);
  ctx.closePath();
}

/** Hand-drawn arrow with a loop, for scrapbook annotations. */
export function doodleArrow(ctx, x0, y0, x1, y1, color, lw, loop = true) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny) || 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  if (loop) {
    const lr = Math.hypot(x1 - x0, y1 - y0) * 0.12;
    ctx.quadraticCurveTo(mx + (nx / nl) * lr * 2, my + (ny / nl) * lr * 2, mx, my);
    ctx.arc(mx - lr * 0.2, my - lr, lr, Math.PI / 2, Math.PI * 2.4);
  }
  ctx.quadraticCurveTo(mx + (nx / nl) * -lw * 6, my + (ny / nl) * -lw * 6, x1, y1);
  ctx.stroke();
  const a = Math.atan2(y1 - my, x1 - mx);
  const hl = lw * 5;
  ctx.beginPath();
  ctx.moveTo(x1 - Math.cos(a - 0.5) * hl, y1 - Math.sin(a - 0.5) * hl);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 - Math.cos(a + 0.5) * hl, y1 - Math.sin(a + 0.5) * hl);
  ctx.stroke();
  ctx.restore();
}

/** Seven-segment digits — the orange date stamp of a point-and-shoot. */
const SEG = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  "'": '', ' ': '', '.': '', '-': 'g',
};
export function segDigits(ctx, str, x, y, h, color, o = {}) {
  const { glow = true, align = 'right', slant = 0.12 } = o;
  const w = h * 0.52, th = h * 0.13, gap = h * 0.2;
  const adv = ch => (ch === "'" || ch === '.' ? h * 0.22 : ch === ' ' ? h * 0.32 : w + gap);
  const total = [...str].reduce((a, ch) => a + adv(ch), 0) - gap;
  let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  ctx.save();
  ctx.fillStyle = color;
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = h * 0.35; }
  ctx.transform(1, 0, -slant, 1, slant * (y + h), 0);
  const seg = (k, ox) => {
    const L = ox, T = y, R = ox + w, B = y + h, M = y + h / 2;
    const pad = th * 0.25;
    const H = (yy, x0, x1) => ctx.fillRect(x0 + pad, yy - th / 2, x1 - x0 - pad * 2, th);
    const V = (xx, y0, y1) => ctx.fillRect(xx - th / 2, y0 + pad, th, y1 - y0 - pad * 2);
    if (k === 'a') H(T + th / 2, L, R);
    if (k === 'g') H(M, L, R);
    if (k === 'd') H(B - th / 2, L, R);
    if (k === 'f') V(L + th / 2, T, M);
    if (k === 'b') V(R - th / 2, T, M);
    if (k === 'e') V(L + th / 2, M, B);
    if (k === 'c') V(R - th / 2, M, B);
  };
  for (const ch of str) {
    if (ch === "'") ctx.fillRect(cx, y, th, h * 0.28);
    else if (ch === '.') ctx.fillRect(cx, y + h - th, th, th);
    else for (const k of SEG[ch] || '') seg(k, cx);
    cx += adv(ch);
  }
  ctx.restore();
}

/* ------------------------------------------------------------ brand mark */

/**
 * The HoloBooth signature: the four-point spark + wordmark. Every design
 * carries it, always small, always in the design's own ink, so it reads as a
 * maker's mark rather than an ad. `variant`:
 *   'lockup'  spark + HOLOBOOTH, tracked caps
 *   'word'    HOLOBOOTH only
 *   'spark'   spark only
 *   'stamp'   spark inside a ring, wordmark beneath
 */
export function brand(ctx, x, y, size, color, o = {}) {
  const { variant = 'lockup', align = 'center', font = FONTS.avenir, weight = 600, tracking = 0.32, word = 'HOLOBOOTH' } = o;
  ctx.save();
  if (variant === 'spark') { sparkle(ctx, x, y - size * 0.36, size * 0.6); ctx.fillStyle = color; ctx.fill(); ctx.restore(); return; }
  if (variant === 'stamp') {
    ctx.strokeStyle = color; ctx.lineWidth = size * 0.07;
    ctx.beginPath(); ctx.arc(x, y - size * 1.1, size * 0.85, 0, TAU); ctx.stroke();
    sparkle(ctx, x, y - size * 1.1, size * 0.55); ctx.fillStyle = color; ctx.fill();
    text(ctx, word, x, y + size * 0.7, { size: size * 0.62, font, weight, tracking, color, align: 'center' });
    ctx.restore(); return;
  }
  const tw = measure(ctx, word, { size, font, weight, tracking });
  const sp = variant === 'lockup' ? size * 1.15 : 0;
  const total = tw + sp;
  let x0 = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  if (variant === 'lockup') {
    sparkle(ctx, x0 + size * 0.38, y - size * 0.36, size * 0.48);
    ctx.fillStyle = color; ctx.fill();
  }
  text(ctx, word, x0 + sp, y, { size, font, weight, tracking, color });
  ctx.restore();
}

/* --------------------------------------------------------------- helpers */

export function hexA(hex, a) {
  if (!hex || hex[0] !== '#') return hex;
  const v = parseInt(hex.length === 4 ? hex.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3').slice(1) : hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

export function rule(ctx, x0, y0, x1, y1, color, w) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.restore();
}

export function frameRect(ctx, x, y, w, h, color, lw, r = 0) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  if (r) roundRect(ctx, x, y, w, h, r); else { ctx.beginPath(); ctx.rect(x, y, w, h); }
  ctx.stroke();
  ctx.restore();
}

export function shadowed(ctx, color, blur, ox, oy, fn) {
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.shadowOffsetX = ox; ctx.shadowOffsetY = oy;
  fn();
  ctx.restore();
}

/** Contain-fit a logo image into a box. */
export function logo(ctx, img, x, y, w, h, align = 'center') {
  if (!img?.width) return false;
  const s = Math.min(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  const dx = align === 'center' ? x + (w - dw) / 2 : align === 'right' ? x + w - dw : x;
  ctx.drawImage(img, dx, y + (h - dh) / 2, dw, dh);
  return true;
}

export { roundRect };
