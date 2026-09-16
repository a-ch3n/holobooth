/**
 * companions.mjs — the mascot roster.
 *
 * A party card wants a little character in the corner badge, and the customer
 * wants to choose which one. This is that roster: twelve original mascots,
 * each tied to an energy type, each drawn from parameters so the booth works
 * out of the box with no art assets at all.
 *
 * When you commission real art, drop a transparent PNG at
 *   src/assets/companions/<id>.png
 * and it replaces the drawn version with no code change. That is the intended
 * path — the procedural mascots are a working placeholder, not the ship art.
 */

import { TAU, roundRect, radGrad, alpha, shade } from './draw.mjs';
import { energy } from './energy.mjs';

/**
 * body:      'round' | 'oval' | 'tall' | 'blob'
 * ears:      'pointy' | 'floppy' | 'antenna' | 'fin' | 'none'
 * accessory: 'bow' | 'scarf' | 'crown' | 'goggles' | 'none'
 * face:      'smile' | 'grin' | 'sleepy' | 'starry'
 */
export const COMPANIONS = [
  { id: 'flare',   name: 'Flare',    type: 'ember',   body: 'round', ears: 'pointy',  accessory: 'scarf',   face: 'grin'   },
  { id: 'puddle',  name: 'Puddle',   type: 'wave',    body: 'blob',  ears: 'fin',     accessory: 'none',    face: 'smile'  },
  { id: 'sprig',   name: 'Sprig',    type: 'leaf',    body: 'oval',  ears: 'antenna', accessory: 'none',    face: 'starry' },
  { id: 'buzz',    name: 'Buzz',     type: 'volt',    body: 'round', ears: 'pointy',  accessory: 'goggles', face: 'grin'   },
  { id: 'mitten',  name: 'Mitten',   type: 'frost',   body: 'round', ears: 'floppy',  accessory: 'scarf',   face: 'sleepy' },
  { id: 'pebble',  name: 'Pebble',   type: 'stone',   body: 'blob',  ears: 'none',    accessory: 'none',    face: 'smile'  },
  { id: 'breezy',  name: 'Breezy',   type: 'gale',    body: 'oval',  ears: 'fin',     accessory: 'none',    face: 'smile'  },
  { id: 'shush',   name: 'Shush',    type: 'shade',   body: 'tall',  ears: 'none',    accessory: 'none',    face: 'sleepy' },
  { id: 'twinkle', name: 'Twinkle',  type: 'radiant', body: 'round', ears: 'floppy',  accessory: 'crown',   face: 'starry' },
  { id: 'bloop',   name: 'Bloop',    type: 'toxin',   body: 'blob',  ears: 'antenna', accessory: 'none',    face: 'grin'   },
  { id: 'bolt',    name: 'Bolt',     type: 'steel',   body: 'tall',  ears: 'pointy',  accessory: 'goggles', face: 'smile'  },
  { id: 'muffin',  name: 'Muffin',   type: 'plain',   body: 'oval',  ears: 'floppy',  accessory: 'bow',     face: 'smile'  },
];

export function companionById(id) {
  return COMPANIONS.find(c => c.id === id) || null;
}

/* ------------------------------------------------------------- drawing */

/**
 * Draw a companion into a square of side `size` at (x, y).
 * Deterministic — the same spec always draws the same mascot, which matters
 * because the picker thumbnail and the printed card must match exactly.
 */
export function drawCompanion(ctx, spec, x, y, size) {
  const e = energy(spec.type);
  const cx = x + size / 2;
  const s = size;
  const ink = '#2b2233';
  const line = s * 0.045;

  ctx.save();
  // Antennae and pointy ears reach well above the body, so draw into a
  // slightly inset box rather than clipping them at the canvas edge.
  ctx.translate(cx, y + s * 0.5);
  ctx.scale(0.76, 0.76);
  ctx.translate(-cx, -(y + s * 0.5));
  ctx.translate(0, s * 0.06);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = ink;
  ctx.lineWidth = line;

  const bodies = {
    round: { rx: 0.34, ry: 0.34, cy: 0.58 },
    oval:  { rx: 0.30, ry: 0.38, cy: 0.56 },
    tall:  { rx: 0.26, ry: 0.42, cy: 0.54 },
    blob:  { rx: 0.38, ry: 0.30, cy: 0.62 },
  };
  const b = bodies[spec.body] || bodies.round;
  const by = y + s * b.cy;
  const rx = s * b.rx, ry = s * b.ry;

  /* ---- ears, drawn behind the body */
  const earFill = shade(e.light, 0.08);
  if (spec.ears === 'pointy') {
    [-1, 1].forEach(d => {
      ctx.beginPath();
      ctx.moveTo(cx + d * rx * 0.55, by - ry * 0.72);
      ctx.lineTo(cx + d * rx * 0.98, by - ry * 1.55);
      ctx.lineTo(cx + d * rx * 0.15, by - ry * 0.95);
      ctx.closePath();
      ctx.fillStyle = earFill; ctx.fill(); ctx.stroke();
    });
  } else if (spec.ears === 'floppy') {
    [-1, 1].forEach(d => {
      ctx.beginPath();
      ctx.ellipse(cx + d * rx * 0.86, by - ry * 0.62, rx * 0.24, ry * 0.46, d * 0.5, 0, TAU);
      ctx.fillStyle = earFill; ctx.fill(); ctx.stroke();
    });
  } else if (spec.ears === 'antenna') {
    [-1, 1].forEach(d => {
      ctx.beginPath();
      ctx.moveTo(cx + d * rx * 0.28, by - ry * 0.85);
      ctx.quadraticCurveTo(cx + d * rx * 0.75, by - ry * 1.5, cx + d * rx * 0.5, by - ry * 1.72);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + d * rx * 0.5, by - ry * 1.78, s * 0.055, 0, TAU);
      ctx.fillStyle = e.base; ctx.fill(); ctx.stroke();
    });
  } else if (spec.ears === 'fin') {
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.42, by - ry * 0.84);
    ctx.quadraticCurveTo(cx + rx * 0.02, by - ry * 1.78, cx + rx * 0.46, by - ry * 0.80);
    ctx.closePath();
    ctx.fillStyle = earFill; ctx.fill(); ctx.stroke();
  }

  /* ---- body */
  ctx.beginPath();
  ctx.ellipse(cx, by, rx, ry, 0, 0, TAU);
  ctx.fillStyle = radGrad(ctx, cx - rx * 0.3, by - ry * 0.4, 0, rx * 1.8,
    [[0, shade(e.light, 0.22)], [0.65, e.light], [1, shade(e.base, 0.12)]]);
  ctx.fill();
  ctx.stroke();

  // belly patch
  ctx.beginPath();
  ctx.ellipse(cx, by + ry * 0.30, rx * 0.52, ry * 0.44, 0, 0, TAU);
  ctx.fillStyle = alpha('#ffffff', 0.55);
  ctx.fill();

  /* ---- feet */
  [-1, 1].forEach(d => {
    ctx.beginPath();
    ctx.ellipse(cx + d * rx * 0.46, by + ry * 0.92, rx * 0.24, ry * 0.14, 0, 0, TAU);
    ctx.fillStyle = shade(e.base, 0.05); ctx.fill(); ctx.stroke();
  });

  /* ---- face */
  const ey = by - ry * 0.12, ex = rx * 0.40;
  ctx.fillStyle = ink;
  if (spec.face === 'sleepy') {
    [-1, 1].forEach(d => {
      ctx.beginPath();
      ctx.arc(cx + d * ex, ey, rx * 0.16, Math.PI * 0.15, Math.PI * 0.85);
      ctx.lineWidth = line * 0.9; ctx.stroke();
    });
  } else if (spec.face === 'starry') {
    [-1, 1].forEach(d => {
      ctx.beginPath(); ctx.arc(cx + d * ex, ey, rx * 0.13, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx + d * ex - rx * 0.045, ey - rx * 0.05, rx * 0.05, 0, TAU); ctx.fill();
      ctx.fillStyle = ink;
    });
  } else {
    [-1, 1].forEach(d => {
      ctx.beginPath(); ctx.arc(cx + d * ex, ey, rx * 0.115, 0, TAU); ctx.fill();
    });
  }

  // cheeks
  ctx.fillStyle = alpha(e.base, 0.45);
  [-1, 1].forEach(d => {
    ctx.beginPath();
    ctx.ellipse(cx + d * rx * 0.70, ey + ry * 0.20, rx * 0.15, ry * 0.09, 0, 0, TAU);
    ctx.fill();
  });

  // mouth
  ctx.strokeStyle = ink;
  ctx.lineWidth = line * 0.85;
  ctx.beginPath();
  if (spec.face === 'grin') {
    ctx.arc(cx, ey + ry * 0.18, rx * 0.28, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = '#c65a72';
    ctx.beginPath();
    ctx.arc(cx, ey + ry * 0.18, rx * 0.26, 0.16 * Math.PI, 0.84 * Math.PI);
    ctx.fill();
  } else {
    ctx.arc(cx, ey + ry * 0.16, rx * 0.20, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  /* ---- accessory */
  ctx.strokeStyle = ink;
  ctx.lineWidth = line;
  if (spec.accessory === 'bow') {
    const bx = cx + rx * 0.62, byy = by - ry * 0.78;
    ctx.fillStyle = '#ff7ba8';
    [-1, 1].forEach(d => {
      ctx.beginPath();
      ctx.ellipse(bx + d * rx * 0.20, byy, rx * 0.19, rx * 0.14, d * 0.5, 0, TAU);
      ctx.fill(); ctx.stroke();
    });
    ctx.beginPath(); ctx.arc(bx, byy, rx * 0.075, 0, TAU); ctx.fill(); ctx.stroke();
  } else if (spec.accessory === 'scarf') {
    const ny = by + ry * 0.44;
    ctx.fillStyle = '#e05b4a';
    [-1, 1].forEach(d => {
      ctx.beginPath();
      ctx.moveTo(cx, ny);
      ctx.lineTo(cx + d * rx * 0.36, ny - ry * 0.15);
      ctx.lineTo(cx + d * rx * 0.36, ny + ry * 0.15);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    });
    ctx.beginPath(); ctx.arc(cx, ny, rx * 0.085, 0, TAU);
    ctx.fillStyle = '#b8412f'; ctx.fill(); ctx.stroke();
  } else if (spec.accessory === 'crown') {
    ctx.fillStyle = '#f5c518';
    ctx.beginPath();
    const kw = rx * 0.56, ky = by - ry * 0.88;
    ctx.moveTo(cx - kw, ky);
    ctx.lineTo(cx - kw * 0.55, ky - rx * 0.34);
    ctx.lineTo(cx, ky - rx * 0.06);
    ctx.lineTo(cx + kw * 0.55, ky - rx * 0.34);
    ctx.lineTo(cx + kw, ky);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else if (spec.accessory === 'goggles') {
    ctx.fillStyle = alpha('#8fd2ff', 0.8);
    [-1, 1].forEach(d => {
      ctx.beginPath();
      ctx.arc(cx + d * ex, ey, rx * 0.22, 0, TAU);
      ctx.fill(); ctx.stroke();
    });
    ctx.beginPath();
    ctx.moveTo(cx - ex, ey); ctx.lineTo(cx + ex, ey);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Render a companion to its own canvas at `size` px, ready to drawImage.
 * Needs a canvas factory because node has no document.
 */
export function companionCanvas(spec, size, makeCanvas) {
  const c = makeCanvas(size, size);
  drawCompanion(c.getContext('2d'), spec, 0, 0, size);
  return c;
}

/** The circular badge the mascot sits in, top-left of a party card. */
export function companionBadge(ctx, img, cx, cy, r, ringColor) {
  ctx.save();
  // glow behind, so a pale mascot still separates from a pale card
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.14, 0, TAU);
  ctx.fillStyle = radGrad(ctx, cx, cy, r * 0.6, r * 1.2,
    [[0, alpha(ringColor, 0.55)], [1, alpha(ringColor, 0)]]);
  ctx.fill();

  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.save();
  ctx.clip();
  if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();

  ctx.lineWidth = r * 0.13;
  ctx.strokeStyle = ringColor;
  ctx.stroke();
  ctx.lineWidth = r * 0.05;
  ctx.strokeStyle = alpha('#ffffff', 0.85);
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.94, 0, TAU); ctx.stroke();
  ctx.restore();
}
