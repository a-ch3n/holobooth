/**
 * strips.mjs — the HoloBooth Photo Strip Collection.
 *
 * One design system, many looks:
 *   - Formats: "strip" = one 2x6 strip, 620 x 1844 px (two per DS40 page,
 *     cut apart); "jumbo" = a whole 4x6 portrait page, 1240 x 1844 px, uncut.
 *   - Every design draws in its format's own pixel units (scaled to whatever
 *     size it's rendered at), so a picker thumbnail and the print are the
 *     same drawing.
 *   - Photos are the hero: real booth proportions (16:9, 4:3, 3:2, 1:1),
 *     centre-cropped with the same maths as the print. With no photo, a photo
 *     box is left blank in the design's own blank colour.
 *   - Shared parts: the HoloBooth mark (a four-point holo spark + wordmark),
 *     the collection code on every strip ("HB·S01"), text fields (title, date,
 *     message, age, logo), and a kit of decorations.
 *   - Everything that must not be cut off is recorded in meta.contentRects
 *     (checked against the 20 px safe area by test/layout.test.mjs).
 *
 * Text fields, in order of preference:
 *   title    the name the customer typed › strips.event.title (config) › the design's default
 *   date     strips.event.date (YYYY-MM-DD or any text) › today
 *   message  strips.event.message › the design's default
 *   age      the age the customer typed › strips.event.age
 *   logo     strips.event.logo (an image) replaces the title where a design has a title slot
 *
 * Adding a design: write draw(D) using the kit below, add it to STYLES with
 * its variants (palettes), and it appears in the picker and the collection
 * book (npm run strips).
 */
import { drawCover, roundRect } from './draw.mjs';

export const FORMATS = {
  strip: { W: 620, H: 1844, label: '2×6 strip' },
  jumbo: { W: 1240, H: 1844, label: '4×6 Jumbo strip' },
};

export const FONT = {
  serif: '"Playfair Display", Georgia, serif',
  elegant: '"Cormorant Garamond", Garamond, Georgia, serif',
  script: '"Great Vibes", "Brush Script MT", cursive',
  hand: 'Caveat, "Segoe Print", "Comic Sans MS", cursive',
  future: 'Orbitron, "Arial Black", sans-serif',
  condensed: 'Anton, Impact, "Arial Narrow", sans-serif',
  marker: '"Permanent Marker", "Segoe Print", cursive',
  mono: '"Courier Prime", "Courier New", monospace',
  round: 'Quicksand, "Arial Rounded MT Bold", sans-serif',
  play: 'Fredoka, "Arial Rounded MT Bold", sans-serif',
  sans: 'Inter, "Segoe UI", Arial, sans-serif',
  korean: '"HoloBooth Hangul", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Droid Sans Fallback", sans-serif',
};

const TAU = Math.PI * 2;

/* ================================================================== kit */

function rng(seed) {
  let a = 0;
  for (const ch of String(seed)) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/** Formats the event date. A date the host typed as free text is shown as typed. */
export function fmtDate(value, style = 'dots') {
  let d = value instanceof Date ? value : null;
  if (!d && typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return value;
    d = new Date(+m[1], +m[2] - 1, +m[3]);
  }
  d ||= new Date();
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear(), yy = String(yyyy).slice(2);
  switch (style) {
    case 'long': return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${yyyy}`;
    case 'month': return `${MONTHS[d.getMonth()]} ${yyyy}`;
    case 'stamp': return `'${yy}  ${d.getMonth() + 1}  ${d.getDate()}`;
    case 'kr': return `${yyyy}.${mm}.${dd}`;
    case 'slash': return `${d.getMonth() + 1}/${d.getDate()}/${yy}`;
    case 'spaced': return `${mm} · ${dd} · ${yyyy}`;
    case 'full': return `${mm}.${dd}.${yyyy}`;
    default: return `${mm}.${dd}.${yy}`;
  }
}

/** The booth's strips.event (title, date, message, age, logo), set once by the kiosk at start-up. */
let EVENT = {};
let LOGO = null;
export function setStripEvent(event = {}, logo = null) {
  EVENT = event || {};
  LOGO = logo;
}

/** "SARAH & JAMES" from the on-screen keyboard → "Sarah & James", so script faces stay readable. */
function titleCase(s) {
  return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s&-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s;
}

/** The text a design shows, from the customer's input, the event config and the design's defaults. */
function fields(meta, def = {}) {
  const ev = meta.event || EVENT || {};
  const p = meta.personal || {};
  return {
    title: (p.provided ? titleCase(p.name) : '') || ev.title || def.title || '',
    date: ev.date || meta.mintedAt || new Date(),
    message: ev.message || def.message || '',
    age: p.age ?? (ev.age === '' || ev.age == null ? null : Number(ev.age)),
    custom: !!(p.provided || ev.title),
  };
}

/**
 * Text, with optional letter-spacing (track, in ems), shrink-to-fit (maxW),
 * an outline and a shadow. Records its box as content unless record:false.
 */
function txt(D, s, x, y, o = {}) {
  const ctx = D.ctx;
  s = String(s ?? '');
  if (!s) return { w: 0, size: 0 };
  const { font = FONT.sans, weight = 400, style = '', color = D.p.ink, align = 'center',
    maxW = D.W - 100, track = 0, base = 'alphabetic', stroke = null, shadow = null, record = true } = o;
  let size = o.size || 30;
  const chars = [...s];
  const set = () => { ctx.font = `${style ? style + ' ' : ''}${weight} ${size}px ${font}`; };
  const width = () => chars.reduce((w, ch) => w + ctx.measureText(ch).width, 0) + track * size * (chars.length - 1);
  set();
  let w = track ? width() : ctx.measureText(s).width;
  for (let i = 0; w > maxW && i < 12; i++) { size *= Math.max(0.6, (maxW / w) * 0.995); set(); w = track ? width() : ctx.measureText(s).width; }
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.save();
  ctx.textBaseline = base;
  ctx.textAlign = 'left';
  if (shadow) { ctx.shadowColor = shadow.color; ctx.shadowBlur = shadow.blur || 0; ctx.shadowOffsetX = shadow.x || 0; ctx.shadowOffsetY = shadow.y || 0; }
  const paint = (fn) => {
    if (!track) return fn(s, x0);
    let cx = x0;
    for (const ch of chars) { fn(ch, cx); cx += ctx.measureText(ch).width + track * size; }
  };
  if (stroke) {
    ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.width;
    paint((t, px) => ctx.strokeText(t, px, y));
    ctx.shadowColor = 'transparent';
  }
  ctx.fillStyle = color;
  paint((t, px) => ctx.fillText(t, px, y));
  ctx.restore();
  const top = base === 'middle' ? y - size * 0.5 : base === 'top' ? y : y - size * 0.78;
  const rect = { x: x0, y: top, w, h: size * (base === 'middle' ? 1 : 1.0) };
  if (record) D.rects.push(rect);
  return { w, size, rect };
}

/** Text turned 90° (angle -90: reads bottom to top), centred on cx, cy. */
function vtxt(D, s, cx, cy, angle, o = {}) {
  const ctx = D.ctx;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle * Math.PI / 180);
  const r = txt(D, s, 0, 0, { ...o, base: 'middle', record: false });
  ctx.restore();
  if (o.record !== false && r.w) D.rects.push({ x: cx - r.size / 2, y: cy - r.w / 2, w: r.size, h: r.w });
  return r;
}

/** Cells of one aspect stacked in a column, as big as fit in box, centred. */
function stack(box, n, aspect, gap) {
  let w = box.w, h = w / aspect;
  if (n * h + (n - 1) * gap > box.h) { h = (box.h - (n - 1) * gap) / n; w = h * aspect; }
  const x = box.x + (box.w - w) / 2;
  const y = box.y + (box.h - (n * h + (n - 1) * gap)) / 2;
  return Array.from({ length: n }, (_, i) => ({ x, y: y + i * (h + gap), w, h }));
}

function archPath(ctx, x, y, w, h) {
  const r = w / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, 0);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

/**
 * A photo box. With a photo: centre-cropped into it (drawCover). Without:
 * left blank, in the design's blank colour. Always recorded as a cell.
 */
function photo(D, r, o = {}) {
  const ctx = D.ctx;
  const i = D.cells.length;
  const img = D.photos.length ? D.photos[i % D.photos.length] : null;
  const { radius = 0, shape = 'rect', blank = D.p.blank, rotate = 0 } = o;
  ctx.save();
  if (rotate) { ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.rotate(rotate); ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2)); }
  if (shape === 'arch') archPath(ctx, r.x, r.y, r.w, r.h);
  else if (radius) roundRect(ctx, r.x, r.y, r.w, r.h, radius);
  else { ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); }
  ctx.clip();
  if (img) drawCover(ctx, img, r.x, r.y, r.w, r.h);
  else { ctx.fillStyle = blank; ctx.fillRect(r.x, r.y, r.w, r.h); }
  ctx.restore();
  D.cells.push(r);
  D.rects.push(rotate ? rotatedBox(r, rotate) : r);
  return r;
}

function rotatedBox(r, a) {
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const w = r.w * c + r.h * s, h = r.w * s + r.h * c;
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
}

function fill(D, style) { D.ctx.fillStyle = style; D.ctx.fillRect(0, 0, D.W, D.H); }

function lin(D, x0, y0, x1, y1, stops) {
  const g = D.ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

/** Seeded dots: film grain, concrete, paper fibres. Drawn under the photos only. */
function grain(D, amount, colors, size = 1.6) {
  const ctx = D.ctx;
  const n = Math.round(D.W * D.H / 1000 * amount);
  ctx.save();
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = 0.04 + D.rnd() * 0.12;
    ctx.fillStyle = colors[i % colors.length];
    const s = size * (0.5 + D.rnd());
    ctx.fillRect(D.rnd() * D.W, D.rnd() * D.H, s, s);
  }
  ctx.restore();
}

function strokeRect(ctx, x, y, w, h, color, lw) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.strokeRect(x, y, w, h); ctx.restore();
}

function heart(ctx, x, y, s, fillStyle, strokeStyle = null, lw = 2) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.32);
  ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.78, x, y + s * 0.95);
  ctx.bezierCurveTo(x, y + s * 0.78, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.32);
  ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.35);
  ctx.closePath();
  if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(); }
  if (strokeStyle) { ctx.strokeStyle = strokeStyle; ctx.lineWidth = lw; ctx.stroke(); }
  ctx.restore();
}

/** Four-point sparkle: the HoloBooth spark. */
function spark(ctx, x, y, r, fillStyle, thin = 0.18) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 4;
    const rr = i % 2 ? r * thin : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.restore();
}

function star5(ctx, x, y, r, fillStyle, strokeStyle = null, lw = 3) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(); }
  if (strokeStyle) { ctx.lineJoin = 'round'; ctx.strokeStyle = strokeStyle; ctx.lineWidth = lw; ctx.stroke(); }
  ctx.restore();
}

/** The holographic gradient of the HoloBooth mark. */
function holo(D, x0, y0, x1, y1) {
  return lin(D, x0, y0, x1, y1, [[0, '#ff5fb8'], [0.25, '#ffb43d'], [0.5, '#2fd3a7'], [0.75, '#4f8dff'], [1, '#a95cff']]);
}

/**
 * The HoloBooth signature: spark + HOLOBOOTH wordmark (+ collection code),
 * centred on x. tone: a colour, or 'holo' for the holographic spark.
 */
function brand(D, x, y, o = {}) {
  const { size = 22, color = D.p.ink, spark: sparkTone = 'holo', code = true, font = FONT.sans, weight = 700, track = 0.32, align = 'center' } = o;
  // The separator dot is drawn, not typed: not every display font has '·'.
  const parts = code ? ['HOLOBOOTH', D.code] : ['HOLOBOOTH'];
  const ctx = D.ctx;
  ctx.save();
  ctx.font = `${weight} ${size}px ${font}`;
  const widths = parts.map(t => [...t].reduce((a, ch) => a + ctx.measureText(ch).width, 0) + track * size * ([...t].length - 1));
  ctx.restore();
  const sw = size * 1.15, sep = size * 1.6;
  const total = sw + size * 0.5 + widths.reduce((a, w) => a + w, 0) + (parts.length - 1) * sep;
  const x0 = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  spark(ctx, x0 + sw / 2, y - size * 0.36, sw / 2, sparkTone === 'holo' ? holo(D, x0, y - sw, x0 + sw, y) : sparkTone);
  let cx = x0 + sw + size * 0.5;
  parts.forEach((t, i) => {
    if (i) {
      ctx.save(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx + sep / 2, y - size * 0.36, size * 0.11, 0, TAU); ctx.fill(); ctx.restore();
      cx += sep;
    }
    txt(D, t, cx, y, { size, color, font, weight, track, align: 'left', maxW: 9999, record: false });
    cx += widths[i];
  });
  D.rects.push({ x: x0, y: y - sw * 0.9, w: total, h: sw });
}

/** A title, or the event's logo in its place when strips.event.logo is set. */
function titleOrLogo(D, box, drawTitle) {
  const logo = D.meta.logo || LOGO;
  if (logo?.width) {
    const k = Math.min(box.w / logo.width, box.h / logo.height);
    const w = logo.width * k, h = logo.height * k;
    D.ctx.drawImage(logo, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
    D.rects.push(box);
    return;
  }
  drawTitle();
}

function tape(ctx, cx, cy, w, h, angle, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  const teeth = 6;
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  for (let i = 1; i <= teeth; i++) ctx.lineTo(w / 2 + (i % 2 ? 5 : 0), -h / 2 + (h * i) / teeth);
  ctx.lineTo(-w / 2, h / 2);
  for (let i = 1; i <= teeth; i++) ctx.lineTo(-w / 2 - (i % 2 ? 5 : 0), h / 2 - (h * i) / teeth);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** A ragged-edged paper patch, as if torn out. */
function torn(D, r, color, angle = 0, jag = 7) {
  const ctx = D.ctx;
  ctx.save();
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
  ctx.rotate(angle);
  const hw = r.w / 2, hh = r.h / 2;
  ctx.beginPath();
  const step = 14;
  for (let x = -hw; x <= hw; x += step) ctx.lineTo(x, -hh + (D.rnd() - 0.5) * jag);
  for (let y = -hh; y <= hh; y += step) ctx.lineTo(hw + (D.rnd() - 0.5) * jag, y);
  for (let x = hw; x >= -hw; x -= step) ctx.lineTo(x, hh + (D.rnd() - 0.5) * jag);
  for (let y = hh; y >= -hh; y -= step) ctx.lineTo(-hw + (D.rnd() - 0.5) * jag, y);
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function sprig(ctx, x, y, len, angle, color, lw = 3, leaves = 7, flip = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -len * 0.12 * flip, len, 0);
  ctx.stroke();
  for (let i = 1; i <= leaves; i++) {
    const t = i / (leaves + 1);
    const px = len * t, py = -len * 0.12 * flip * 4 * t * (1 - t) * 0.5;
    const s = len * 0.11 * (1 - t * 0.45);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(side * 0.75 - 0.15);
      ctx.beginPath();
      ctx.ellipse(s * 0.9 * side * 0 + s * 0.85, 0, s, s * 0.38, 0, 0, TAU);
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

function confetti(D, box, colors, n, avoid = []) {
  const ctx = D.ctx;
  for (let i = 0; i < n; i++) {
    const x = box.x + D.rnd() * box.w, y = box.y + D.rnd() * box.h;
    if (avoid.some(r => x > r.x - 14 && x < r.x + r.w + 14 && y > r.y - 14 && y < r.y + r.h + 14)) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(D.rnd() * TAU);
    ctx.fillStyle = colors[i % colors.length];
    const k = D.rnd();
    if (k < 0.4) ctx.fillRect(-9, -4, 18, 8);
    else if (k < 0.7) { ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(8, 6); ctx.lineTo(-8, 6); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
}

function barcode(D, x, y, w, h, color) {
  const ctx = D.ctx;
  ctx.fillStyle = color;
  let cx = x;
  while (cx < x + w) {
    const bw = [2, 2, 3, 5, 2, 4][Math.floor(D.rnd() * 6)];
    if (D.rnd() > 0.35) ctx.fillRect(cx, y, Math.min(bw, x + w - cx), h);
    cx += bw + 2;
  }
  D.rects.push({ x, y, w, h });
}

function sprockets(D, x, y0, y1, w, color, pitch = 46) {
  const ctx = D.ctx;
  ctx.fillStyle = color;
  for (let y = y0; y + 30 < y1; y += pitch) { roundRect(ctx, x, y, w, 30, 5); ctx.fill(); }
}

/* ======================================================== the designs */

/** A. Minimalist Luxury — "Atelier": hairline frames, editorial calm. */
function atelier(D) {
  const { ctx, W, H, p } = D;
  const f = fields(D.meta, { title: 'An Evening to Remember' });
  fill(D, p.paper);
  const m = 44;
  strokeRect(ctx, 22.5, 22.5, W - 45, H - 45, p.line, 1.5);
  strokeRect(ctx, 30.5, 30.5, W - 61, H - 61, p.line, 0.75);
  txt(D, 'H O L O B O O T H', W / 2, 92, { font: FONT.elegant, weight: 500, size: 24, color: p.accent, track: 0.12 });
  ctx.fillStyle = p.accent; ctx.fillRect(W / 2 - 40, 114, 80, 1.5);
  const cells = stack({ x: m, y: 150, w: W - 2 * m, h: H - 150 - 330 }, 4, 4 / 3, 26);
  cells.forEach(r => photo(D, r));
  const by = cells[3].y + cells[3].h;
  titleOrLogo(D, { x: 70, y: by + 40, w: W - 140, h: 120 }, () => {
    txt(D, f.title, W / 2, by + 118, { font: FONT.elegant, style: 'italic', weight: 400, size: 62, color: p.ink, maxW: W - 120 });
  });
  txt(D, fmtDate(f.date, 'long'), W / 2, by + 190, { font: FONT.sans, weight: 500, size: 22, color: p.accent, track: 0.3 });
  spark(ctx, W / 2, by + 240, 11, p.accent);
  txt(D, `COLLECTION ${D.code}`, W / 2, H - 52, { font: FONT.sans, weight: 500, size: 20, color: p.dim, track: 0.4 });
}

/** B. Retro Film — "Darkroom 400": a strip of film, sprockets, edge codes, a date stamp. */
function darkroom(D) {
  const { ctx, W, H, p } = D;
  const f = fields(D.meta, { title: 'Holo Film 400' });
  if (p.booth) return photoBooth1972(D, f);
  fill(D, p.film);
  // Colour bands: the film box.
  ctx.fillStyle = p.band1; ctx.fillRect(0, 0, W, 132);
  ctx.fillStyle = p.band2; ctx.fillRect(0, 132, W, 14);
  ctx.fillStyle = p.band1; ctx.fillRect(0, H - 150, W, 150);
  ctx.fillStyle = p.band2; ctx.fillRect(0, H - 164, W, 14);
  txt(D, 'HOLO FILM', 58, 82, { font: FONT.condensed, size: 58, color: p.bandInk, align: 'left', track: 0.02 });
  txt(D, '400', W - 58, 82, { font: FONT.condensed, size: 58, color: p.band2, align: 'right' });
  txt(D, 'COLOR  ·  36 EXP  ·  ISO 400', 58, 116, { font: FONT.sans, weight: 700, size: 18, color: p.bandInk, align: 'left', track: 0.18 });
  grain(D, 2.2, ['#ffffff', '#c8a060']);
  const top = 146, bot = H - 164;
  sprockets(D, 26, top + 20, bot - 10, 36, p.hole);
  sprockets(D, W - 62, top + 20, bot - 10, 36, p.hole);
  const cells = stack({ x: 86, y: top + 34, w: W - 172, h: bot - top - 68 }, 4, 4 / 3, 44);
  cells.forEach((r, i) => {
    photo(D, r, { radius: 6 });
    // Edge codes between frames, like real film.
    txt(D, `${i + 1}`, 44, r.y + r.h + 32, { font: FONT.mono, weight: 700, size: 20, color: p.edge, record: false });
    txt(D, `${i + 1}A`, W - 44, r.y + r.h + 32, { font: FONT.mono, weight: 700, size: 20, color: p.edge, record: false });
    vtxt(D, `HOLO 400  —  ${String(i * 2 + 12).padStart(2, '0')}`, W - 16 - 30, r.y + r.h / 2, 90, { font: FONT.mono, weight: 700, size: 13, color: p.edge, track: 0.1, record: false });
  });
  const last = cells[3];
  txt(D, fmtDate(f.date, 'stamp'), last.x + last.w - 6, last.y + last.h + 36, {
    font: FONT.mono, weight: 700, size: 26, color: '#ff8a1f', align: 'right', shadow: { color: 'rgba(255,120,20,.85)', blur: 10 },
  });
  titleOrLogo(D, { x: 50, y: H - 140, w: W - 100, h: 70 }, () => {
    txt(D, f.title.toUpperCase(), W / 2, H - 82, { font: FONT.condensed, size: 44, color: p.bandInk, track: 0.06, maxW: W - 110 });
  });
  brand(D, W / 2, H - 38, { size: 20, color: p.bandInk, spark: p.bandInk });
}

/** B (variant). The old-school booth strip: deckled cream border, four tight frames, a rubber stamp. */
function photoBooth1972(D, f) {
  const { ctx, W, H, p } = D;
  fill(D, p.paper);
  grain(D, 1.6, ['#8a6a3a', '#ffffff']);
  // Deckled edge, inside the bleed.
  ctx.save();
  ctx.strokeStyle = p.line; ctx.lineWidth = 2; ctx.setLineDash([3, 5]);
  ctx.strokeRect(34, 34, W - 68, H - 68);
  ctx.restore();
  const cells = stack({ x: 60, y: 70, w: W - 120, h: H - 70 - 300 }, 4, 1 / 0.86, 18);
  cells.forEach(r => photo(D, r, { blank: p.blank }));
  const by = cells[3].y + cells[3].h;
  txt(D, 'PHOTO·MATIC', W / 2, by + 86, { font: FONT.serif, weight: 900, size: 46, color: p.ink, track: 0.06 });
  titleOrLogo(D, { x: 70, y: by + 104, w: W - 140, h: 56 }, () => {
    txt(D, f.title, W / 2, by + 146, { font: FONT.hand, weight: 700, size: 48, color: p.accent, maxW: W - 140 });
  });
  // Rubber stamp.
  ctx.save();
  ctx.translate(W / 2, by + 214);
  ctx.rotate(-0.05);
  ctx.strokeStyle = p.stamp; ctx.lineWidth = 3;
  roundRect(ctx, -150, -26, 300, 52, 8); ctx.stroke();
  ctx.restore();
  txt(D, fmtDate(f.date, 'long'), W / 2, by + 223, { font: FONT.mono, weight: 700, size: 22, color: p.stamp, maxW: 280 });
  brand(D, W / 2, H - 52, { size: 20, color: p.dim, spark: p.dim });
}

/** C. Y2K — "Cyber Babe": chrome type, bubble frames, sparkles, a desktop window. */
function y2k(D) {
  const { ctx, W, H, p } = D;
  const f = fields(D.meta, { title: 'BESTIES 4EVER', message: 'born to be online' });
  fill(D, lin(D, 0, 0, W, H, p.bg));
  // Chrome streaks.
  ctx.save();
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = lin(D, 0, 0, W, 0, [[0, 'rgba(255,255,255,0)'], [0.5, '#ffffff'], [1, 'rgba(255,255,255,0)']]);
    ctx.save(); ctx.translate(W / 2, 260 + i * 330); ctx.rotate(-0.5); ctx.fillRect(-W, -6, W * 2, 12); ctx.restore();
  }
  ctx.restore();
  // Window title bar.
  ctx.save();
  ctx.fillStyle = lin(D, 0, 40, 0, 96, [[0, '#ffffff'], [0.5, p.chrome2], [1, p.chrome1]]);
  roundRect(ctx, 40, 40, W - 80, 56, 14); ctx.fill();
  ctx.strokeStyle = p.edge; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();
  txt(D, 'holobooth.exe', 64, 77, { font: FONT.future, weight: 800, size: 22, color: p.edge, align: 'left' });
  ['_', '□', '×'].forEach((g, i) => {
    const cx = W - 70 - i * 40;
    ctx.save(); ctx.fillStyle = '#ffffff'; ctx.strokeStyle = p.edge; ctx.lineWidth = 2.5;
    roundRect(ctx, cx - 15, 53, 30, 30, 7); ctx.fill(); ctx.stroke(); ctx.restore();
    txt(D, g, cx, 76, { font: FONT.sans, weight: 800, size: 20, color: p.edge, record: false });
  });
  const cells = stack({ x: 60, y: 126, w: W - 120, h: H - 126 - 360 }, 4, 4 / 3, 30);
  cells.forEach(r => {
    ctx.save();
    ctx.fillStyle = lin(D, r.x, r.y, r.x + r.w, r.y + r.h, [[0, '#ffffff'], [0.35, p.chrome1], [0.7, '#ffffff'], [1, p.chrome2]]);
    roundRect(ctx, r.x - 9, r.y - 9, r.w + 18, r.h + 18, 30); ctx.fill();
    ctx.strokeStyle = p.edge; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.restore();
    photo(D, r, { radius: 22 });
  });
  // Sparkles and stickers, in the margins only.
  const cs = D.rnd;
  [[44, 118, 18], [W - 40, 420, 16], [38, 900, 14], [W - 44, 1250, 20], [W - 40, 160, 10]].forEach(([x, y, r]) => spark(ctx, x, y, r, '#ffffff'));
  const by = cells[3].y + cells[3].h;
  heart(ctx, 86, by + 36, 34, p.sticker, p.edge, 3);
  star5(ctx, W - 88, by + 52, 22, '#fff27a', p.edge, 3);
  void cs;
  titleOrLogo(D, { x: 50, y: by + 70, w: W - 100, h: 120 }, () => {
    const g = lin(D, 0, by + 90, 0, by + 170, [[0, '#ffffff'], [0.45, p.chrome1], [0.55, p.chrome2], [1, '#ffffff']]);
    txt(D, f.title.toUpperCase(), W / 2, by + 160, {
      font: FONT.future, weight: 800, size: 60, color: g, maxW: W - 100,
      stroke: { color: p.edge, width: 7 }, shadow: { color: 'rgba(0,0,0,.25)', blur: 0, y: 5 },
    });
  });
  const msg = txt(D, f.message, W / 2, by + 226, { font: FONT.round, weight: 700, size: 30, color: p.edge, maxW: W - 160 });
  heart(ctx, W / 2 - msg.w / 2 - 24, by + 202, 24, p.sticker);
  heart(ctx, W / 2 + msg.w / 2 + 24, by + 202, 24, p.sticker);
  txt(D, fmtDate(f.date, 'slash'), W / 2, by + 274, { font: FONT.future, weight: 500, size: 22, color: p.edge, track: 0.2 });
  brand(D, W / 2, H - 46, { size: 20, color: p.edge, font: FONT.future, weight: 500 });
}

/** D. Korean booth — "Four Cut": clean white, pastel accents, cute doodles, Hangul. */
function fourCut(D) {
  const { ctx, W, H, p } = D;
  const f = fields(D.meta, { title: '오늘의 우리', message: 'our little moment' });
  fill(D, p.paper);
  const cells = stack({ x: 34, y: 124, w: W - 68, h: H - 124 - 250 }, 4, 4 / 3, 16);
  // Pill label on top.
  ctx.save(); ctx.fillStyle = p.accent; roundRect(ctx, W / 2 - 150, 42, 300, 54, 27); ctx.fill(); ctx.restore();
  titleOrLogo(D, { x: W / 2 - 140, y: 44, w: 280, h: 50 }, () => {
    txt(D, f.custom ? f.title : '오늘의 우리', W / 2, 79, { font: f.custom ? FONT.round : FONT.korean, weight: 700, size: 28, color: p.onAccent, maxW: 270 });
  });
  heart(ctx, W / 2 - 176, 52, 26, p.accent);
  spark(ctx, W / 2 + 178, 70, 15, p.accent2);
  cells.forEach(r => photo(D, r, { radius: 4 }));
  const by = cells[3].y + cells[3].h;
  // Doodles: a bow, stars, a cloud.
  bow(ctx, 92, by + 70, 30, p.accent);
  star5(ctx, W - 96, by + 58, 16, p.accent2);
  star5(ctx, W - 132, by + 92, 9, p.accent);
  txt(D, f.message, W / 2, by + 84, { font: FONT.round, weight: 700, size: 30, color: p.ink, maxW: W - 260 });
  txt(D, fmtDate(f.date, 'kr'), W / 2, by + 128, { font: FONT.round, weight: 500, size: 22, color: p.dim, track: 0.12 });
  ctx.fillStyle = p.accent; ctx.fillRect(W / 2 - 24, by + 158, 48, 3);
  brand(D, W / 2, H - 50, { size: 20, color: p.ink, font: FONT.round, weight: 700 });
}

function bow(ctx, x, y, s, color) {
  ctx.save();
  ctx.fillStyle = color;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + side * s * 1.1, y - s * 0.9, x + side * s * 1.3, y + s * 0.6, x, y);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + side * s * 0.55, y + s * 1.05);
    ctx.lineTo(x + side * s * 0.2, y + s * 1.0);
    ctx.closePath(); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(x, y, s * 0.2, 0, TAU); ctx.fill();
  ctx.restore();
}

/** E. Editorial — "Cover Story": masthead, asymmetric photos, cover lines, barcode. */
function coverStory(D) {
  const { ctx, W, H, p } = D;
  const f = fields(D.meta, { title: 'The Night Of', message: 'EXCLUSIVE · THE PHOTOS EVERYONE WILL TALK ABOUT' });
  fill(D, p.paper);
  txt(D, 'HOLO', W / 2, 184, { font: FONT.serif, weight: 900, size: 196, color: p.ink, maxW: W - 70, track: -0.02 });
  txt(D, 'ISSUE Nº 26', 40, 228, { font: FONT.sans, weight: 800, size: 19, color: p.ink, align: 'left', track: 0.25 });
  txt(D, fmtDate(f.date, 'month'), W - 40, 228, { font: FONT.sans, weight: 800, size: 19, color: p.ink, align: 'right', track: 0.25, maxW: 300 });
  ctx.fillStyle = p.ink; ctx.fillRect(40, 244, W - 80, 3);
  // Hero, then two squares side by side, then an offset wide frame.
  const hero = photo(D, { x: 40, y: 270, w: W - 80, h: (W - 80) * 3 / 4 });
  let y = hero.y + hero.h + 22;
  const sq = (W - 80 - 18) / 2;
  photo(D, { x: 40, y, w: sq, h: sq });
  photo(D, { x: 40 + sq + 18, y, w: sq, h: sq });
  y += sq + 22;
  const wide = photo(D, { x: 40, y, w: W - 80 - 72, h: (W - 80 - 72) * 9 / 16 * 1.25 });
  vtxt(D, 'THE COLLECTION', W - 40 - 30, wide.y + wide.h / 2, 90, { font: FONT.sans, weight: 800, size: 20, color: p.ink, track: 0.3 });
  y = wide.y + wide.h + 54;
  titleOrLogo(D, { x: 40, y: y - 46, w: W - 80, h: 70 }, () => {
    txt(D, f.title, 40, y + 6, { font: FONT.serif, weight: 700, style: 'italic', size: 64, color: p.ink, align: 'left', maxW: W - 80 });
  });
  txt(D, f.message.toUpperCase(), 40, y + 52, { font: FONT.sans, weight: 700, size: 19, color: p.dim, align: 'left', track: 0.12, maxW: W - 80 });
  barcode(D, W - 40 - 170, H - 132, 170, 62, p.ink);
  txt(D, `VOL. ${fmtDate(f.date, 'full')}`, W - 40, H - 52, { font: FONT.mono, weight: 700, size: 20, color: p.ink, align: 'right', maxW: 260 });
  brand(D, 40, H - 90, { size: 20, color: p.ink, align: 'left', spark: p.ink });
}

/** F. Polaroid Collection — "Instant": three instant frames, handwritten captions, tape. */
function instant(D) {
  const { ctx, W, H, p } = D;
  const f = fields(D.meta, { title: 'Good times', message: 'best night ever' });
  fill(D, p.bg);
  grain(D, 1.2, p.fibre);
  titleOrLogo(D, { x: 60, y: 44, w: W - 120, h: 90 }, () => {
    txt(D, f.title, W / 2, 118, { font: FONT.hand, weight: 700, size: 72, color: p.ink, maxW: W - 120 });
  });
  const captions = [f.message, fmtDate(f.date, 'slash'), 'love you all'];
  const tilts = [-0.035, 0.028, -0.02];
  const fw = 452, ph = 400, side = 26, bottom = 96;
  const fh = side + ph + bottom;
  for (let i = 0; i < 3; i++) {
    const cx = W / 2 + (i % 2 ? 14 : -14), cy = 168 + fh / 2 + i * (fh - 6);
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(tilts[i]);
    ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
    ctx.fillStyle = p.frame; ctx.fillRect(-fw / 2, -fh / 2, fw, fh);
    ctx.shadowColor = 'transparent';
    ctx.restore();
    const r = { x: cx - (fw / 2 - side), y: cy - fh / 2 + side, w: fw - 2 * side, h: ph };
    // The photo shares the frame's tilt.
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(tilts[i]); ctx.translate(-cx, -cy);
    photo(D, r, { blank: p.blank });
    D.rects.pop(); D.rects.push(rotatedBox(r, tilts[i]));
    txt(D, captions[i], cx, cy + fh / 2 - 34, { font: FONT.hand, weight: 500, size: 40, color: p.pen, maxW: fw - 60, record: false });
    ctx.restore();
    D.rects.push(rotatedBox({ x: cx - fw / 2, y: cy - fh / 2, w: fw, h: fh }, tilts[i]));
    tape(ctx, cx + (i % 2 ? -120 : 130), cy - fh / 2 + 6, 120, 34, i % 2 ? -0.35 : 0.3, p.tape);
  }
  brand(D, W / 2, H - 46, { size: 20, color: p.ink, spark: p.ink });
}

/** G. Chrome / Futuristic — "Liquid Metal": reflective silver, holo lines, chrome bevels. */
function liquidMetal(D) {
  const { ctx, W, H, p } = D;
  const f = fields(D.meta, { title: 'HOLOBOOTH', message: 'SYSTEM // ONLINE' });
  fill(D, lin(D, 0, 0, W * 0.35, H, p.bg));
  ctx.save(); ctx.globalAlpha = p.dark ? 0.25 : 0.5;
  ctx.fillStyle = lin(D, 0, 0, W, 0, [[0, 'rgba(255,255,255,0)'], [0.48, '#ffffff'], [0.52, '#ffffff'], [1, 'rgba(255,255,255,0)']]);
  ctx.translate(W / 2, H / 2); ctx.rotate(0.35); ctx.fillRect(-W * 1.2, -H, W * 0.5, H * 2); ctx.restore();
  // Header wordmark.
  titleOrLogo(D, { x: 50, y: 40, w: W - 100, h: 90 }, () => {
    txt(D, f.title.toUpperCase(), W / 2, 108, {
      font: FONT.future, weight: 800, size: 54, maxW: W - 100, track: 0.08,
      color: lin(D, 0, 60, 0, 112, [[0, p.dark ? '#ffffff' : '#ffffff'], [0.5, p.dark ? '#9ea6b3' : '#5d6672'], [0.52, p.dark ? '#d8dde5' : '#2b313a'], [1, p.dark ? '#ffffff' : '#9aa2ad']]),
      stroke: p.dark ? null : { color: 'rgba(30,34,40,.55)', width: 2 },
    });
  });
  ctx.fillStyle = holo(D, 60, 0, W - 60, 0); ctx.fillRect(60, 134, W - 120, 4);
  const cells = stack({ x: 56, y: 166, w: W - 112, h: H - 166 - 250 }, 4, 16 / 10, 30);
  cells.forEach(r => {
    ctx.save();
    ctx.fillStyle = lin(D, r.x, r.y - 10, r.x + r.w, r.y + r.h + 10, p.bevel);
    roundRect(ctx, r.x - 10, r.y - 10, r.w + 20, r.h + 20, 16); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = holo(D, r.x, r.y, r.x + r.w, r.y + r.h); ctx.lineWidth = 3;
    roundRect(ctx, r.x - 3, r.y - 3, r.w + 6, r.h + 6, 10); ctx.stroke();
    ctx.restore();
    photo(D, r, { radius: 8 });
  });
  const by = cells[3].y + cells[3].h;
  txt(D, f.message, W / 2, by + 82, { font: FONT.future, weight: 500, size: 24, color: p.ink, track: 0.2, maxW: W - 100 });
  txt(D, fmtDate(f.date, 'full'), W / 2, by + 126, { font: FONT.mono, weight: 700, size: 22, color: p.dim, track: 0.2 });
  spark(ctx, W / 2, by + 170, 16, holo(D, W / 2 - 16, by + 154, W / 2 + 16, by + 186));
  brand(D, W / 2, H - 48, { size: 20, color: p.ink, font: FONT.future, weight: 500 });
}

/** H. Scrapbook — "Cut & Paste": torn paper, tape, stickers, notes in pen. */
function scrapbook(D) {
  const { ctx, W, H, p } = D;
  const f = fields(D.meta, { title: 'us', message: 'remember this?' });
  fill(D, p.bg);
  if (p.lined) {
    ctx.save();
    ctx.strokeStyle = p.rule; ctx.lineWidth = 2;
    for (let y = 110; y < H; y += 44) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = p.margin; ctx.beginPath(); ctx.moveTo(70, 0); ctx.lineTo(70, H); ctx.stroke();
    ctx.restore();
  } else grain(D, 2.4, p.fibre, 2.4);
  titleOrLogo(D, { x: 60, y: 40, w: W - 120, h: 100 }, () => {
    const t = txt(D, f.title, W / 2, 122, { font: FONT.marker, size: 66, color: p.ink, maxW: W - 200 });
    heart(ctx, W / 2 + t.w / 2 + 44, 70, 44, p.sticker2, '#ffffff', 4);
  });
  const cells = stack({ x: 96, y: 170, w: W - 192, h: H - 170 - 280 }, 4, 4 / 3, 52);
  const tilts = [0.03, -0.035, 0.025, -0.02];
  const patches = [p.paper1, p.paper2, p.paper1, p.paper2];
  cells.forEach((r, i) => {
    const off = i % 2 ? -18 : 18;
    torn(D, { x: r.x - 26 + off, y: r.y - 22, w: r.w + 52, h: r.h + 44 }, patches[i], -tilts[i] * 1.6);
    const rr = { ...r, x: r.x + off };
    photo(D, rr, { rotate: tilts[i] });
    tape(ctx, rr.x + (i % 2 ? rr.w - 20 : 20), rr.y - 4, 104, 32, i % 2 ? 0.55 : -0.55, p.tape);
  });
  // Notes and stickers in the gaps.
  const n1 = cells[0], n2 = cells[2];
  txt(D, f.message, W / 2 + 40, n1.y + n1.h + 48, { font: FONT.hand, weight: 700, size: 34, color: p.pen, maxW: 320 });
  txt(D, 'no. 1 crew', W / 2 - 40, n2.y + n2.h + 48, { font: FONT.hand, weight: 700, size: 34, color: p.pen, maxW: 320 });
  const by = cells[3].y + cells[3].h;
  star5(ctx, 70, by + 74, 30, p.sticker1, '#ffffff', 5);
  heart(ctx, W - 76, by + 44, 52, p.sticker2, '#ffffff', 5);
  smiley(ctx, W - 132, cells[1].y - 18, 26, p.sticker1);
  txt(D, fmtDate(f.date, 'slash'), W / 2, by + 110, { font: FONT.hand, weight: 700, size: 44, color: p.pen });
  brand(D, W / 2, H - 52, { size: 20, color: p.ink, spark: p.ink });
}

function smiley(ctx, x, y, r, color) {
  ctx.save();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath(); ctx.arc(x - r * 0.33, y - r * 0.2, r * 0.11, 0, TAU); ctx.arc(x + r * 0.33, y - r * 0.2, r * 0.11, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = r * 0.12; ctx.beginPath(); ctx.arc(x, y + r * 0.05, r * 0.5, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
  ctx.restore();
}

/** I. Date Night — "Love Letter": arched frames, script names, hearts. */
function loveLetter(D) {
  const { ctx, W, H, p } = D;
  const f = fields(D.meta, { title: 'You & Me', message: 'forever starts tonight' });
  fill(D, p.paper);
  strokeRect(ctx, 28.5, 28.5, W - 57, H - 57, p.line, 1.5);
  heart(ctx, W / 2, 56, 30, p.accent);
  const cells = stack({ x: 70, y: 112, w: W - 140, h: H - 112 - 330 }, 3, 0.82, 34);
  cells.forEach(r => {
    ctx.save(); ctx.strokeStyle = p.line; ctx.lineWidth = 1.5;
    archPath(ctx, r.x - 10, r.y - 10, r.w + 20, r.h + 20); ctx.stroke(); ctx.restore();
    photo(D, r, { shape: 'arch' });
  });
  const by = cells[2].y + cells[2].h;
  titleOrLogo(D, { x: 60, y: by + 30, w: W - 120, h: 140 }, () => {
    txt(D, f.title, W / 2, by + 132, { font: FONT.script, size: 92, color: p.ink, maxW: W - 130 });
  });
  txt(D, fmtDate(f.date, 'spaced'), W / 2, by + 196, { font: FONT.elegant, weight: 600, size: 28, color: p.accent, track: 0.12 });
  txt(D, f.message, W / 2, by + 240, { font: FONT.elegant, style: 'italic', weight: 400, size: 30, color: p.dim, maxW: W - 140 });
  [[W / 2 - 28, by + 262, 13], [W / 2, by + 270, 17], [W / 2 + 28, by + 262, 13]].forEach(([x, y, s]) => heart(ctx, x, y, s, p.accent));
  brand(D, W / 2, H - 50, { size: 20, color: p.dim, spark: p.accent, font: FONT.sans });
}

/** J. Birthday Edition — "Party Pop": colour, confetti, balloons, an age badge. */
function partyPop(D) {
  const { ctx, W, H, p } = D;
  const f = fields(D.meta, { title: '', message: 'make a wish!' });
  fill(D, p.bg);
  const cells = stack({ x: 58, y: 236, w: W - 116, h: H - 236 - 300 }, 4, 4 / 3, 34);
  confetti(D, { x: 20, y: 20, w: W - 40, h: H - 40 }, p.confetti, 260, [...cells, { x: 40, y: 30, w: W - 80, h: 190 }, { x: 40, y: H - 290, w: W - 80, h: 240 }]);
  balloon(ctx, 74, 110, 34, p.confetti[0]);
  balloon(ctx, W - 74, 96, 38, p.confetti[2]);
  txt(D, 'HAPPY', W / 2, 108, { font: FONT.play, weight: 700, size: 66, color: p.title1, stroke: { color: p.outline, width: 10 }, track: 0.04 });
  txt(D, 'BIRTHDAY', W / 2, 186, { font: FONT.play, weight: 700, size: 76, color: p.title2, stroke: { color: p.outline, width: 10 }, maxW: W - 200, track: 0.02 });
  cells.forEach((r, i) => {
    ctx.save(); ctx.fillStyle = p.frames[i % p.frames.length];
    roundRect(ctx, r.x - 12, r.y - 12, r.w + 24, r.h + 24, 26); ctx.fill(); ctx.restore();
    photo(D, r, { radius: 16 });
  });
  const by = cells[3].y + cells[3].h;
  // Age badge.
  const age = f.age;
  if (age != null) {
    ctx.save(); ctx.fillStyle = p.badge; ctx.beginPath(); ctx.arc(W - 118, by + 104, 64, 0, TAU); ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = p.outline; ctx.stroke(); ctx.restore();
    txt(D, String(age), W - 118, by + 128, { font: FONT.play, weight: 700, size: 70, color: '#ffffff', maxW: 104 });
    D.rects.push({ x: W - 182, y: by + 40, w: 128, h: 128 });
  }
  const tx = age != null ? (W - 160) / 2 + 10 : W / 2;
  const tw = age != null ? W - 260 : W - 120;
  titleOrLogo(D, { x: tx - tw / 2, y: by + 44, w: tw, h: 80 }, () => {
    txt(D, f.title || 'Birthday Crew', tx, by + 108, { font: FONT.play, weight: 700, size: 54, color: p.ink, maxW: tw });
  });
  txt(D, f.message, tx, by + 158, { font: FONT.play, weight: 500, size: 30, color: p.ink, maxW: tw });
  txt(D, fmtDate(f.date, 'long'), W / 2, by + 214, { font: FONT.play, weight: 500, size: 22, color: p.dim, track: 0.12 });
  brand(D, W / 2, H - 48, { size: 20, color: p.ink, font: FONT.play, weight: 700 });
}

function balloon(ctx, x, y, r, color) {
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y + r * 1.2); ctx.bezierCurveTo(x - 10, y + r * 1.8, x + 12, y + r * 2.2, x, y + r * 2.8); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(x, y, r * 0.86, r * 1.1, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 7, y + r * 1.22); ctx.lineTo(x + 7, y + r * 1.22); ctx.lineTo(x, y + r * 1.06); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.beginPath(); ctx.ellipse(x - r * 0.3, y - r * 0.4, r * 0.16, r * 0.28, -0.5, 0, TAU); ctx.fill();
  ctx.restore();
}

/** K. Event / Wedding — "Keepsake": script names, botanical line art, gold hairlines. */
function keepsake(D) {
  const { ctx, W, H, p } = D;
  const f = fields(D.meta, { title: 'Happily Ever After', message: 'Thank you for celebrating with us' });
  fill(D, p.paper);
  strokeRect(ctx, 26.5, 26.5, W - 53, H - 53, p.line, 1.2);
  if (p.florals) {
    sprig(ctx, W / 2 - 14, 112, 190, Math.PI + 0.22, p.leaf, 2.5, 7, 1);
    sprig(ctx, W / 2 + 14, 112, 190, -0.22, p.leaf, 2.5, 7, -1);
  } else {
    ctx.fillStyle = p.line; ctx.fillRect(W / 2 - 110, 98, 220, 1.2);
  }
  spark(ctx, W / 2, 104, 12, p.accent, 0.25);
  const cells = stack({ x: 62, y: 150, w: W - 124, h: H - 150 - 360 }, 4, 3 / 2, 30);
  cells.forEach(r => {
    strokeRect(ctx, r.x - 8.5, r.y - 8.5, r.w + 17, r.h + 17, p.accent, 1.2);
    photo(D, r);
  });
  const by = cells[3].y + cells[3].h;
  titleOrLogo(D, { x: 50, y: by + 36, w: W - 100, h: 130 }, () => {
    txt(D, f.title, W / 2, by + 132, { font: FONT.script, size: 82, color: p.ink, maxW: W - 110 });
  });
  txt(D, fmtDate(f.date, 'full'), W / 2, by + 196, { font: FONT.elegant, weight: 600, size: 32, color: p.accent, track: 0.22 });
  txt(D, f.message, W / 2, by + 246, { font: FONT.elegant, style: 'italic', weight: 400, size: 28, color: p.dim, maxW: W - 120 });
  brand(D, W / 2, H - 48, { size: 20, color: p.dim, spark: p.accent, font: FONT.sans });
}

/** L. Streetwear / Urban — "Off Grid": concrete, condensed type, a marker tag with drips. */
function offGrid(D) {
  const { ctx, W, H, p } = D;
  const f = fields(D.meta, { title: 'NO SLEEP CREW', message: 'EST. 2026' });
  fill(D, p.bg);
  grain(D, 4, p.speck, 2.2);
  // Giant vertical wordmark down the right edge.
  vtxt(D, 'HOLOBOOTH', W - 80, H / 2 - 40, 90, { font: FONT.condensed, size: 104, color: p.big, track: 0.02, maxW: H - 360, record: false });
  D.rects.push({ x: W - 132, y: 200, w: 104, h: H - 520 });
  const cells = stack({ x: 40, y: 150, w: W - 40 - 150, h: H - 150 - 330 }, 4, 4 / 3, 22);
  cells.forEach(r => {
    ctx.fillStyle = p.frame; ctx.fillRect(r.x - 7, r.y - 7, r.w + 14, r.h + 14);
    photo(D, r);
  });
  txt(D, 'NO. 04', 40, 70, { font: FONT.condensed, size: 34, color: p.ink, align: 'left', track: 0.08 });
  txt(D, f.message, W - 40, 70, { font: FONT.condensed, size: 34, color: p.ink, align: 'right', track: 0.08, maxW: 260 });
  ctx.fillStyle = p.ink; ctx.fillRect(40, 92, W - 80, 6);
  txt(D, 'LIMITED / DO NOT DUPLICATE', 40, 130, { font: FONT.sans, weight: 800, size: 18, color: p.dim, align: 'left', track: 0.2 });
  const by = cells[3].y + cells[3].h;
  titleOrLogo(D, { x: 40, y: by + 34, w: W - 80, h: 140 }, () => {
    const r = txt(D, f.title, W / 2, by + 126, { font: FONT.marker, size: 76, color: p.tag, maxW: W - 90, stroke: { color: p.tagEdge, width: 8 } });
    // Paint drips under the tag.
    ctx.save(); ctx.fillStyle = p.tag;
    for (let i = 0; i < 6; i++) {
      const x = W / 2 - r.w / 2 + 30 + D.rnd() * (r.w - 60), len = 16 + D.rnd() * 30;
      roundRect(ctx, x, by + 118, 7, len, 3.5); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 3.5, by + 118 + len, 5, 0, TAU); ctx.fill();
    }
    ctx.restore();
  });
  barcode(D, 40, H - 132, 210, 54, p.ink);
  txt(D, fmtDate(f.date, 'full'), W - 40, H - 88, { font: FONT.condensed, size: 34, color: p.ink, align: 'right', track: 0.06 });
  brand(D, W - 40, H - 48, { size: 20, color: p.ink, align: 'right', spark: p.ink, font: FONT.sans, weight: 800 });
}

/* ------------------------------------------------------ jumbo designs */

/** Jumbo 1. "Grand Gallery": three big uncropped 16:9 frames, side rails of type. */
function grandGallery(D) {
  const { ctx, W, H, p } = D;
  const f = fields(D.meta, { title: 'An Evening to Remember', message: 'Shot on HoloBooth' });
  fill(D, p.bg === 'holo' ? lin(D, 0, 0, W, H, [[0, '#e9edf3'], [0.45, '#b9c0cb'], [0.55, '#f4f6f9'], [1, '#a8b0bb']]) : p.bg);
  if (p.bg === 'holo') { ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = holo(D, 0, 0, W, H); ctx.fillRect(0, 0, W, H); ctx.restore(); }
  strokeRect(ctx, 34.5, 34.5, W - 69, H - 69, p.line, 2);
  titleOrLogo(D, { x: 140, y: 60, w: W - 280, h: 120 }, () => {
    txt(D, f.title, W / 2, 150, { font: FONT.elegant, style: 'italic', weight: 400, size: 92, color: p.ink, maxW: W - 280 });
  });
  const cells = stack({ x: 130, y: 200, w: W - 260, h: H - 200 - 190 }, 3, 16 / 9, 32);
  cells.forEach((r, i) => {
    photo(D, r);
    txt(D, `0${i + 1}`, r.x - 34, r.y + 34, { font: FONT.sans, weight: 700, size: 22, color: p.accent, align: 'right', record: false });
  });
  vtxt(D, fmtDate(f.date, 'long'), 88, H / 2, -90, { font: FONT.sans, weight: 700, size: 26, color: p.accent, track: 0.4 });
  vtxt(D, 'HOLOBOOTH  ·  JUMBO EDITION', W - 88, H / 2, 90, { font: FONT.sans, weight: 700, size: 26, color: p.accent, track: 0.4 });
  const by = cells[2].y + cells[2].h;
  txt(D, f.message, W / 2, by + 84, { font: FONT.elegant, weight: 500, size: 44, color: p.ink, track: 0.06, maxW: W - 300 });
  brand(D, W / 2, H - 70, { size: 22, color: p.dim, spark: p.bg === 'holo' ? 'holo' : p.accent });
}

/** Jumbo 2. "Contact Sheet": an oversized film strip of four, with a side column of type. */
function contactSheet(D) {
  const { ctx, W, H, p } = D;
  const f = fields(D.meta, { title: 'Roll Nº 26', message: 'four frames, one night' });
  fill(D, p.bg);
  grain(D, 1, ['#000000', '#ffffff']);
  const fx = 60, fw = 760;
  ctx.save(); ctx.fillStyle = p.film; ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
  ctx.fillRect(fx, 40, fw, H - 80); ctx.restore();
  sprockets(D, fx + 30, 70, H - 70, 46, p.hole, 62);
  sprockets(D, fx + fw - 76, 70, H - 70, 46, p.hole, 62);
  const cells = stack({ x: fx + 112, y: 90, w: fw - 224, h: H - 180 }, 4, 4 / 3, 40);
  cells.forEach((r, i) => {
    photo(D, r, { radius: 8 });
    txt(D, `${i + 1}        ${i + 1}A`, r.x + r.w / 2, r.y + r.h + 30, { font: FONT.mono, weight: 700, size: 22, color: p.edge, record: false });
  });
  // The side column.
  const cx = fx + fw + (W - fx - fw) / 2;
  const cw = W - fx - fw - 80;
  txt(D, 'HOLO', cx, 190, { font: FONT.condensed, size: 140, color: p.ink, maxW: cw });
  txt(D, 'FILM', cx, 320, { font: FONT.condensed, size: 140, color: p.accent, maxW: cw });
  ctx.fillStyle = p.ink; ctx.fillRect(cx - cw / 2, 356, cw, 5);
  titleOrLogo(D, { x: cx - cw / 2, y: 400, w: cw, h: 220 }, () => {
    txt(D, f.title, cx, 500, { font: FONT.hand, weight: 700, size: 92, color: p.ink, maxW: cw });
  });
  txt(D, f.message, cx, 590, { font: FONT.hand, weight: 500, size: 50, color: p.dim, maxW: cw });
  vtxt(D, fmtDate(f.date, 'long'), cx, H / 2 + 330, -90, { font: FONT.condensed, size: 64, color: p.ink, track: 0.06, maxW: 760 });
  txt(D, fmtDate(f.date, 'stamp'), cx, H - 210, { font: FONT.mono, weight: 700, size: 40, color: '#ff8a1f', shadow: { color: 'rgba(255,120,20,.8)', blur: 12 } });
  txt(D, 'ISO 400 · 4 EXP', cx, H - 150, { font: FONT.sans, weight: 700, size: 22, color: p.dim, track: 0.2, maxW: cw });
  brand(D, cx, H - 88, { size: 20, color: p.ink, code: false, spark: p.accent });
  txt(D, D.code, cx, H - 52, { font: FONT.sans, weight: 700, size: 18, color: p.dim, track: 0.3 });
}

/** Jumbo 3. "The Issue": a fashion cover — masthead, hero, a row of three, cover lines. */
function theIssue(D) {
  const { ctx, W, H, p } = D;
  const f = fields(D.meta, { title: 'The Night Of', message: 'Exclusive: the photos everyone will talk about' });
  fill(D, p.paper);
  txt(D, 'HOLOBOOTH', W / 2, 238, { font: FONT.serif, weight: 900, size: 250, color: p.ink, maxW: W - 110, track: -0.02 });
  txt(D, 'THE JUMBO ISSUE', 60, 296, { font: FONT.sans, weight: 800, size: 24, color: p.ink, align: 'left', track: 0.3 });
  txt(D, fmtDate(f.date, 'month'), W - 60, 296, { font: FONT.sans, weight: 800, size: 24, color: p.ink, align: 'right', track: 0.3, maxW: 420 });
  ctx.fillStyle = p.ink; ctx.fillRect(60, 318, W - 120, 4);
  const hero = photo(D, { x: 60, y: 346, w: W - 120, h: (W - 120) * 9 / 16 });
  const sq = (W - 120 - 2 * 26) / 3;
  const ry = hero.y + hero.h + 26;
  for (let i = 0; i < 3; i++) photo(D, { x: 60 + i * (sq + 26), y: ry, w: sq, h: sq });
  const ty = ry + sq + 96;
  titleOrLogo(D, { x: 60, y: ty - 86, w: 760, h: 120 }, () => {
    txt(D, f.title, 60, ty, { font: FONT.serif, weight: 700, style: 'italic', size: 100, color: p.ink, align: 'left', maxW: 760 });
  });
  txt(D, f.message.toUpperCase(), 60, ty + 60, { font: FONT.sans, weight: 700, size: 22, color: p.dim, align: 'left', track: 0.12, maxW: 760 });
  txt(D, '4', W - 60, ty + 30, { font: FONT.serif, weight: 900, size: 170, color: p.accent, align: 'right' });
  txt(D, 'LOOKS', W - 60, ty + 70, { font: FONT.sans, weight: 800, size: 22, color: p.ink, align: 'right', track: 0.3 });
  barcode(D, W - 60 - 240, H - 150, 240, 70, p.ink);
  brand(D, 60, H - 90, { size: 22, color: p.ink, align: 'left', spark: p.ink });
  txt(D, `VOL. ${fmtDate(f.date, 'full')}`, 60, H - 52, { font: FONT.mono, weight: 700, size: 20, color: p.dim, align: 'left' });
}

/* ========================================================== catalogue */

const ink = (paper, ink, extra = {}) => ({ paper, ink, ...extra });

/**
 * The collection. code: the collection number printed on each strip. Each
 * variant is a palette (and, for a few, a layout switch). personalize: the
 * design asks the customer for a name (and age).
 */
export const STYLES = [
  { id: 'atelier', code: 'S01', family: 'Minimalist Luxury', name: 'Atelier', draw: atelier, variants: [
    { id: 'ivory', name: 'Ivory', swatch: '#efe7da', p: ink('#f4eee4', '#2a2420', { accent: '#a88a5c', line: '#c9b89b', dim: '#9a8c78', blank: '#e3d9ca' }) },
    { id: 'noir', name: 'Noir', swatch: '#111111', p: ink('#0f0f0f', '#f3eee6', { accent: '#c9b58c', line: '#5a5246', dim: '#8d8576', blank: '#262626' }) },
    { id: 'blanc', name: 'Blanc', swatch: '#ffffff', p: ink('#ffffff', '#111111', { accent: '#111111', line: '#cfcfcf', dim: '#8a8a8a', blank: '#ececec' }) },
  ] },
  { id: 'darkroom', code: 'S02', family: 'Retro Film', name: 'Darkroom 400', draw: darkroom, variants: [
    { id: 'gold', name: 'Gold 400', swatch: '#f2b51c', p: { film: '#141110', band1: '#f2b51c', band2: '#d9361f', bandInk: '#1d1209', hole: '#f3ead8', edge: '#e6a33a', ink: '#f3ead8', blank: '#2b2420' } },
    { id: 'sepia', name: 'Sepia', swatch: '#6b4a2e', p: { film: '#21160e', band1: '#e9dcc0', band2: '#8b5a2b', bandInk: '#2d1c0e', hole: '#e9dcc0', edge: '#c99a5e', ink: '#e9dcc0', blank: '#3a2a1d' } },
    { id: 'booth', name: 'Booth 1972', swatch: '#efe3c8', p: { booth: true, paper: '#f1e6cc', ink: '#2c2218', accent: '#b4462c', stamp: '#b4462c', line: '#bda57a', dim: '#8c7a5c', blank: '#d9cba9' } },
  ] },
  { id: 'cyber', code: 'S03', family: 'Y2K', name: 'Cyber Babe', draw: y2k, variants: [
    { id: 'bubblegum', name: 'Bubblegum', swatch: '#ff9fd2', p: { bg: [[0, '#ffc6e6'], [0.45, '#f1f3f8'], [0.75, '#cfe0ff'], [1, '#ff9fd2']], chrome1: '#c9d0dc', chrome2: '#a4adbc', edge: '#d1338a', sticker: '#ff6fb5', ink: '#d1338a', blank: '#f6e9f3' } },
    { id: 'cyberblue', name: 'Cyber Blue', swatch: '#8fb8ff', p: { bg: [[0, '#bcd6ff'], [0.4, '#eef2fa'], [0.7, '#d7c9ff'], [1, '#8fb8ff']], chrome1: '#c3cad6', chrome2: '#9aa5b8', edge: '#2b4fd1', sticker: '#7aa2ff', ink: '#2b4fd1', blank: '#e8eefb' } },
  ] },
  { id: 'fourcut', code: 'S04', family: 'Korean Photo Booth', name: 'Four Cut', personalize: true, draw: fourCut, variants: [
    { id: 'milk', name: 'Milk', swatch: '#ffffff', p: { paper: '#ffffff', ink: '#4a3f44', dim: '#a3979c', accent: '#f7b6c8', accent2: '#ffd98a', onAccent: '#ffffff', blank: '#f1eef0' } },
    { id: 'peach', name: 'Peach', swatch: '#fde3dc', p: { paper: '#fde6df', ink: '#6b4a45', dim: '#b8918a', accent: '#f39b8f', accent2: '#ffffff', onAccent: '#ffffff', blank: '#fbf3f0' } },
    { id: 'sky', name: 'Sky', swatch: '#dceafb', p: { paper: '#e0ecfb', ink: '#3d4f6b', dim: '#8ea1bd', accent: '#8cb4ec', accent2: '#ffffff', onAccent: '#ffffff', blank: '#f3f7fd' } },
  ] },
  { id: 'cover', code: 'S05', family: 'Editorial Magazine', name: 'Cover Story', draw: coverStory, variants: [
    { id: 'white', name: 'White Issue', swatch: '#ffffff', p: ink('#ffffff', '#0d0d0d', { dim: '#6b6b6b', blank: '#e6e6e6' }) },
    { id: 'black', name: 'Black Issue', swatch: '#0d0d0d', p: ink('#0d0d0d', '#f5f5f5', { dim: '#9a9a9a', blank: '#2a2a2a' }) },
    { id: 'sand', name: 'Sand Issue', swatch: '#e6dfd2', p: ink('#e7e0d3', '#1d1a16', { dim: '#7d7466', blank: '#d3cab9' }) },
  ] },
  { id: 'instant', code: 'S06', family: 'Polaroid Collection', name: 'Instant', draw: instant, variants: [
    { id: 'classic', name: 'Classic', swatch: '#f4f0e8', p: { bg: '#ece6da', fibre: ['#b9ad97', '#ffffff'], frame: '#fbfaf6', ink: '#3b342b', pen: '#2f3b63', tape: 'rgba(255,240,170,.75)', blank: '#e6e1d8' } },
    { id: 'vintage', name: 'Vintage', swatch: '#5a4030', p: { bg: '#4b3527', fibre: ['#2b1d14', '#7a5a43'], frame: '#efe4cc', ink: '#f2e6cf', pen: '#4a3424', tape: 'rgba(230,210,170,.7)', blank: '#d8cbb0' } },
  ] },
  { id: 'chrome', code: 'S07', family: 'Chrome / Futuristic', name: 'Liquid Metal', draw: liquidMetal, variants: [
    { id: 'silver', name: 'Silver', swatch: '#c4c9d1', p: { bg: [[0, '#f4f6f9'], [0.25, '#aab1bc'], [0.5, '#eef1f5'], [0.75, '#8d95a1'], [1, '#e2e6eb']], bevel: [[0, '#ffffff'], [0.3, '#8f97a3'], [0.6, '#f2f4f7'], [1, '#6d7581']], ink: '#1f242b', dim: '#4c535d', blank: '#d9dde3' } },
    { id: 'night', name: 'Holo Night', swatch: '#1a1d24', p: { dark: true, bg: [[0, '#2a2e36'], [0.3, '#0e1014'], [0.6, '#262a32'], [1, '#0b0c0f']], bevel: [[0, '#5f6773'], [0.4, '#1b1e24'], [0.7, '#8a93a0'], [1, '#2a2e36']], ink: '#eef1f6', dim: '#9aa3b0', blank: '#20242b' } },
  ] },
  { id: 'scrapbook', code: 'S08', family: 'Scrapbook', name: 'Cut & Paste', draw: scrapbook, variants: [
    { id: 'kraft', name: 'Kraft', swatch: '#c49a6c', p: { bg: '#c9a173', fibre: ['#8e6a43', '#e7caa2'], paper1: '#fbf7ee', paper2: '#f3e3c2', tape: 'rgba(255,214,228,.82)', pen: '#2b2b2b', ink: '#2b2b2b', sticker1: '#ffcc33', sticker2: '#ff6f91', blank: '#e4d8c4' } },
    { id: 'notebook', name: 'Notebook', swatch: '#f7f7f2', p: { bg: '#fbfbf6', lined: true, rule: '#c9dcf2', margin: '#f2a3a3', paper1: '#fff6c9', paper2: '#e1f1ff', tape: 'rgba(150,220,200,.75)', pen: '#2244aa', ink: '#1d1d1d', sticker1: '#7bd389', sticker2: '#ff8fb1', blank: '#ebebe6' } },
  ] },
  { id: 'loveletter', code: 'S09', family: 'Date Night / Couples', name: 'Love Letter', personalize: true, draw: loveLetter, variants: [
    { id: 'rouge', name: 'Rouge', swatch: '#5c1220', p: ink('#5a111f', '#f7e4e2', { accent: '#f2a7b1', line: '#a8475a', dim: '#e2b7bb', blank: '#74202f' }) },
    { id: 'blush', name: 'Blush', swatch: '#f7e1df', p: ink('#f8e6e4', '#6e2233', { accent: '#c9566c', line: '#e0aab3', dim: '#a06a73', blank: '#efd3d1' }) },
    { id: 'midnight', name: 'Midnight', swatch: '#141b2e', p: ink('#131a2c', '#f1e6d2', { accent: '#d8b673', line: '#4a5571', dim: '#b9ab92', blank: '#232c44' }) },
  ] },
  { id: 'partypop', code: 'S10', family: 'Birthday Edition', name: 'Party Pop', personalize: true, draw: partyPop, variants: [
    { id: 'confetti', name: 'Confetti Pop', swatch: '#ffd23f', p: { bg: '#fffaf0', confetti: ['#ff5a8a', '#ffd23f', '#39c0ed', '#7ad66b', '#a066ff'], frames: ['#ff5a8a', '#39c0ed', '#ffd23f', '#7ad66b'], title1: '#ff5a8a', title2: '#ffd23f', outline: '#2a1d4a', badge: '#a066ff', ink: '#2a1d4a', dim: '#6b5f86', blank: '#f2ede2' } },
    { id: 'pastel', name: 'Pastel Party', swatch: '#e9dcff', p: { bg: '#eee4ff', confetti: ['#ffb3c7', '#ffe08a', '#a8e1f5', '#b9ecb1', '#cdb4ff'], frames: ['#ffffff'], title1: '#ffffff', title2: '#ffe08a', outline: '#7b5cc4', badge: '#ff8fb1', ink: '#4f3a8a', dim: '#8a7bb5', blank: '#f6f1ff' } },
  ] },
  { id: 'keepsake', code: 'S11', family: 'Event / Wedding Edition', name: 'Keepsake', personalize: true, draw: keepsake, variants: [
    { id: 'sage', name: 'Ivory & Sage', swatch: '#f6f1e7', p: ink('#f7f2e8', '#3a3a32', { florals: true, leaf: '#8fa585', accent: '#b8975a', line: '#d9cdb5', dim: '#857f70', blank: '#e8e0d0' }) },
    { id: 'blacktie', name: 'Black Tie', swatch: '#101010', p: ink('#101010', '#f4efe4', { florals: false, accent: '#cfb07a', line: '#4b4436', dim: '#a59c8c', blank: '#252525' }) },
    { id: 'blushgold', name: 'Blush & Gold', swatch: '#f6e4dc', p: ink('#f7e9e2', '#5b3b37', { florals: true, leaf: '#c99a6b', accent: '#b8865a', line: '#e3c3b4', dim: '#9a7a70', blank: '#efdcd3' }) },
  ] },
  { id: 'offgrid', code: 'S12', family: 'Streetwear / Urban', name: 'Off Grid', draw: offGrid, variants: [
    { id: 'black', name: 'Blackout', swatch: '#141414', p: { bg: '#141414', speck: ['#ffffff', '#8a8a8a'], big: 'rgba(255,255,255,.12)', frame: '#cfd3d8', ink: '#f2f2f2', dim: '#8d8d8d', tag: '#d9dde2', tagEdge: '#0a0a0a', blank: '#2c2c2c' } },
    { id: 'silver', name: 'Silver', swatch: '#c9ccd1', p: { bg: '#c7cace', speck: ['#ffffff', '#5a5a5a'], big: 'rgba(0,0,0,.10)', frame: '#111111', ink: '#111111', dim: '#4f4f4f', tag: '#111111', tagEdge: '#ffffff', blank: '#b2b6bc' } },
  ] },
];

export const JUMBO_STYLES = [
  { id: 'gallery', code: 'J01', family: 'Jumbo · Extra-wide vertical', name: 'Grand Gallery', cells: 3, draw: grandGallery, variants: [
    { id: 'ivory', name: 'Ivory', swatch: '#f3ede3', p: { bg: '#f4eee4', ink: '#2a2420', accent: '#a88a5c', line: '#cdbd9f', dim: '#8f8170', blank: '#e3d9ca' } },
    { id: 'noir', name: 'Noir', swatch: '#0f0f0f', p: { bg: '#0f0f0f', ink: '#f3eee6', accent: '#c9b58c', line: '#4d463c', dim: '#8d8576', blank: '#262626' } },
    { id: 'holo', name: 'Holo Chrome', swatch: '#c8ced8', p: { bg: 'holo', ink: '#1f242b', accent: '#3d4450', line: '#ffffff', dim: '#4c535d', blank: '#e3e7ed' } },
  ] },
  { id: 'contact', code: 'J02', family: 'Jumbo · Oversized film strip', name: 'Contact Sheet', cells: 4, draw: contactSheet, variants: [
    { id: 'gold', name: 'Gold Box', swatch: '#f2b51c', p: { bg: '#f2b51c', film: '#141110', hole: '#f3ead8', edge: '#e6a33a', ink: '#1d1209', accent: '#d9361f', dim: '#5a3d12', blank: '#2b2420' } },
    { id: 'lightbox', name: 'Lightbox', swatch: '#f4f4f1', p: { bg: '#f3f3ef', film: '#151515', hole: '#f3f3ef', edge: '#d5a03c', ink: '#151515', accent: '#d9361f', dim: '#6d6d6d', blank: '#2a2a2a' } },
  ] },
  { id: 'issue', code: 'J03', family: 'Jumbo · Modern editorial', name: 'The Issue', cells: 4, draw: theIssue, variants: [
    { id: 'white', name: 'White', swatch: '#ffffff', p: { paper: '#ffffff', ink: '#0d0d0d', accent: '#d9361f', dim: '#6b6b6b', blank: '#e6e6e6' } },
    { id: 'black', name: 'Black', swatch: '#0d0d0d', p: { paper: '#0d0d0d', ink: '#f5f5f5', accent: '#c9b58c', dim: '#9a9a9a', blank: '#2a2a2a' } },
  ] },
];

export const COLLECTION_NAME = 'HoloBooth Photo Strip Collection';

/* ============================================================ template */

/**
 * The template for every collection frame (TEMPLATES.strip with a
 * frame.style, and TEMPLATES.jumbo). Draws at the format's native units,
 * scaled to W.
 */
export function styledStrip(ctx, { W, H, frame, photos = [], photo = null, meta }) {
  const format = FORMATS[frame.format || 'strip'];
  const list = frame.format === 'jumbo' ? JUMBO_STYLES : STYLES;
  const style = list.find(s => s.id === frame.style) || list[0];
  const variant = style.variants.find(v => v.id === frame.styleVariant) || style.variants[0];
  const k = W / format.W;
  const D = {
    ctx, W: format.W, H: format.H, p: variant.p, meta,
    photos: (photos.length ? photos : photo ? [photo] : []).filter(Boolean),
    cells: [], rects: [], code: `HB-${style.code}`, rnd: rng(`${style.id}-${variant.id}`),
  };
  ctx.save();
  ctx.scale(k, H / format.H);
  style.draw(D);
  ctx.restore();
  const sc = r => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });
  const cells = D.cells.map(sc);
  if (cells.length) {
    const x0 = Math.min(...cells.map(c => c.x)), y0 = Math.min(...cells.map(c => c.y));
    const x1 = Math.max(...cells.map(c => c.x + c.w)), y1 = Math.max(...cells.map(c => c.y + c.h));
    meta.artWindow = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, r: 0 };
    meta.cell = { w: cells[0].w, h: cells[0].h };
  }
  meta.cells = cells;
  meta.contentRects = D.rects.map(sc);
  return meta;
}

/** Frames for the picker: one per style × variant. */
export function collectionFrames() {
  const out = [];
  const add = (format, s, v, i) => out.push({
    id: `${format === 'jumbo' ? 'jumbo' : 'sc'}-${s.id}-${v.id}`,
    name: `${s.name} · ${v.name}`,
    baseName: s.name,
    family: s.family,
    format,
    style: s.id,
    styleVariant: v.id,
    swatch: v.swatch,
    personalize: !!s.personalize,
    code: s.code,
    cells: s.cells || 4,
    order: i,
  });
  STYLES.forEach((s, i) => s.variants.forEach(v => add('strip', s, v, i)));
  JUMBO_STYLES.forEach((s, i) => s.variants.forEach(v => add('jumbo', s, v, i)));
  return out;
}
