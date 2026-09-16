/**
 * stickers.mjs — the decoration layer.
 *
 * The customer taps a sticker, it lands on their photo, and they drag, pinch
 * and twist it into place. This module owns the catalogue and the drawing; the
 * kiosk owns the gestures, and the renderer composites placed stickers into the
 * card's photo window so what they arranged is what prints.
 *
 * Two kinds:
 *   'buddy' — the mascots from companions.mjs, reused as stickers
 *   'deco'  — the decorations below, drawn from paths
 *
 * Placed stickers are stored in coordinates NORMALISED TO THE PHOTO WINDOW
 * (0..1), never pixels. That is what lets someone arrange a sticker on a 340px
 * on-screen preview and have it land in the same spot on a 750x1050 print
 * master — and on a 3600px prop board.
 */

import { TAU, roundRect, starPath, heartPath, radGrad, alpha, shade, font } from './draw.mjs';
import { COMPANIONS, companionById, drawCompanion } from './companions.mjs';

export const DECOS = [
  { id: 'heart',    name: 'Heart',    color: '#ff5d8f' },
  { id: 'star',     name: 'Star',     color: '#ffc93c' },
  { id: 'sparkle',  name: 'Sparkle',  color: '#8ce9ff' },
  { id: 'crown',    name: 'Crown',    color: '#f5c518' },
  { id: 'bow',      name: 'Bow',      color: '#ff8fb8' },
  { id: 'cloud',    name: 'Cloud',    color: '#dff1ff' },
  { id: 'rainbow',  name: 'Rainbow',  color: '#ff9ec2' },
  { id: 'hat',      name: 'Party Hat', color: '#7c5cff' },
  { id: 'balloon',  name: 'Balloon',  color: '#ff6b6b' },
  { id: 'bolt',     name: 'Bolt',     color: '#ffd93d' },
  { id: 'flower',   name: 'Flower',   color: '#ff9ec2' },
  { id: 'note',     name: 'Music',    color: '#59d9c4' },
  { id: 'speech',   name: 'Speech',   color: '#ffffff' },
  { id: 'paw',      name: 'Paw',      color: '#c39a6b' },
];

/** Everything the picker can offer, buddies first. */
export function stickerCatalog() {
  return [
    ...COMPANIONS.map(c => ({ id: `buddy:${c.id}`, name: c.name, kind: 'buddy', spec: c })),
    ...DECOS.map(d => ({ id: `deco:${d.id}`, name: d.name, kind: 'deco', spec: d })),
  ];
}

export function stickerById(id) {
  return stickerCatalog().find(s => s.id === id) || null;
}

/* =============================================================== drawing */

const INK = '#2b2233';

/** Draw one decoration filling a box of side `s` at (x, y). */
export function drawDeco(ctx, id, x, y, s) {
  const d = DECOS.find(k => k.id === id) || DECOS[0];
  const cx = x + s / 2, cy = y + s / 2, r = s * 0.36;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = s * 0.055;
  ctx.fillStyle = d.color;

  switch (id) {
    case 'heart':
      heartPath(ctx, cx, cy, r * 1.05); ctx.fill(); ctx.stroke();
      ctx.fillStyle = alpha('#ffffff', 0.55);
      ctx.beginPath(); ctx.ellipse(cx - r * 0.34, cy - r * 0.28, r * 0.20, r * 0.13, -0.5, 0, TAU); ctx.fill();
      break;

    case 'star':
      starPath(ctx, cx, cy, r * 1.10, r * 0.46, 5); ctx.fill(); ctx.stroke();
      break;

    case 'sparkle':
      // four-point twinkle plus two small companions
      starPath(ctx, cx, cy, r * 1.05, r * 0.20, 4); ctx.fill(); ctx.stroke();
      ctx.lineWidth = s * 0.032;
      starPath(ctx, cx + r * 0.86, cy - r * 0.78, r * 0.34, r * 0.08, 4); ctx.fill(); ctx.stroke();
      starPath(ctx, cx - r * 0.82, cy + r * 0.72, r * 0.26, r * 0.06, 4); ctx.fill(); ctx.stroke();
      break;

    case 'crown': {
      const w = r * 1.25, h = r * 0.95;
      ctx.beginPath();
      ctx.moveTo(cx - w, cy + h * 0.55);
      ctx.lineTo(cx - w * 0.92, cy - h * 0.55);
      ctx.lineTo(cx - w * 0.42, cy + h * 0.02);
      ctx.lineTo(cx, cy - h * 0.80);
      ctx.lineTo(cx + w * 0.42, cy + h * 0.02);
      ctx.lineTo(cx + w * 0.92, cy - h * 0.55);
      ctx.lineTo(cx + w, cy + h * 0.55);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e0463c';
      [-0.55, 0, 0.55].forEach(o => {
        ctx.beginPath(); ctx.arc(cx + o * w, cy + h * 0.22, r * 0.13, 0, TAU); ctx.fill();
      });
      break;
    }

    case 'bow':
      [-1, 1].forEach(dir => {
        ctx.beginPath();
        ctx.ellipse(cx + dir * r * 0.66, cy, r * 0.62, r * 0.46, dir * 0.42, 0, TAU);
        ctx.fill(); ctx.stroke();
      });
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.26, 0, TAU); ctx.fill(); ctx.stroke();
      break;

    case 'cloud': {
      // One outlined silhouette, not three overlapping circles — otherwise the
      // internal edges show as seams once it sits on a photo.
      ctx.beginPath();
      ctx.moveTo(cx - r * 1.10, cy + r * 0.52);
      ctx.arc(cx - r * 0.62, cy + r * 0.10, r * 0.50, Math.PI * 0.75, Math.PI * 1.55);
      ctx.arc(cx, cy - r * 0.22, r * 0.66, Math.PI * 1.15, Math.PI * 1.90);
      ctx.arc(cx + r * 0.66, cy + r * 0.10, r * 0.50, Math.PI * 1.55, Math.PI * 0.30);
      ctx.lineTo(cx + r * 1.10, cy + r * 0.52);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    }

    case 'rainbow': {
      const bands = ['#ff6b6b', '#ffb84d', '#ffe66d', '#7fd97f', '#6bc7ff', '#b48cff'];
      ctx.lineCap = 'butt';
      bands.forEach((col, i) => {
        ctx.strokeStyle = col;
        ctx.lineWidth = r * 0.19;
        ctx.beginPath();
        ctx.arc(cx, cy + r * 0.52, r * (0.96 - i * 0.155), Math.PI, 0);
        ctx.stroke();
      });
      break;
    }

    case 'hat': {
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 1.15);
      ctx.lineTo(cx + r * 0.78, cy + r * 0.72);
      ctx.lineTo(cx - r * 0.78, cy + r * 0.72);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff3b0';
      [[-0.28, -0.30], [0.26, 0.06], [-0.10, 0.42]].forEach(([dx, dy]) => {
        ctx.beginPath(); ctx.arc(cx + dx * r, cy + dy * r, r * 0.13, 0, TAU); ctx.fill();
      });
      ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.arc(cx, cy - r * 1.20, r * 0.20, 0, TAU); ctx.fill(); ctx.stroke();
      break;
    }

    case 'balloon':
      ctx.beginPath();
      ctx.ellipse(cx, cy - r * 0.24, r * 0.72, r * 0.88, 0, 0, TAU);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.62);
      ctx.quadraticCurveTo(cx + r * 0.30, cy + r * 0.98, cx - r * 0.10, cy + r * 1.30);
      ctx.lineWidth = s * 0.030;
      ctx.stroke();
      ctx.fillStyle = alpha('#ffffff', 0.5);
      ctx.beginPath(); ctx.ellipse(cx - r * 0.26, cy - r * 0.52, r * 0.16, r * 0.24, -0.4, 0, TAU); ctx.fill();
      break;

    case 'bolt':
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.42, cy - r * 1.08);
      ctx.lineTo(cx - r * 0.62, cy + r * 0.14);
      ctx.lineTo(cx - r * 0.02, cy + r * 0.14);
      ctx.lineTo(cx - r * 0.34, cy + r * 1.10);
      ctx.lineTo(cx + r * 0.68, cy - r * 0.20);
      ctx.lineTo(cx + r * 0.06, cy - r * 0.20);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;

    case 'flower':
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * r * 0.56, cy + Math.sin(a) * r * 0.56,
          r * 0.42, r * 0.30, a, 0, TAU);
        ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = '#ffd93d';
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.30, 0, TAU); ctx.fill(); ctx.stroke();
      break;

    case 'note':
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.34, cy + r * 0.62, r * 0.38, r * 0.28, -0.35, 0, TAU);
      ctx.fill(); ctx.stroke();
      ctx.lineWidth = s * 0.055;
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.02, cy + r * 0.62);
      ctx.lineTo(cx + r * 0.02, cy - r * 0.92);
      ctx.lineTo(cx + r * 0.86, cy - r * 1.14);
      ctx.stroke();
      break;

    case 'speech':
      ctx.beginPath();
      roundRect(ctx, cx - r * 1.05, cy - r * 0.92, r * 2.10, r * 1.46, r * 0.42);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.30, cy + r * 0.50);
      ctx.lineTo(cx - r * 0.52, cy + r * 1.14);
      ctx.lineTo(cx + r * 0.10, cy + r * 0.52);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = font(900, r * 0.92, 'Nunito, system-ui, sans-serif');
      ctx.fillText('!', cx, cy - r * 0.16);
      break;

    case 'paw':
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.36, r * 0.62, r * 0.52, 0, 0, TAU);
      ctx.fill(); ctx.stroke();
      [[-0.62, -0.44], [-0.22, -0.74], [0.24, -0.74], [0.64, -0.44]].forEach(([dx, dy]) => {
        ctx.beginPath();
        ctx.ellipse(cx + dx * r, cy + dy * r, r * 0.22, r * 0.28, dx * 0.4, 0, TAU);
        ctx.fill(); ctx.stroke();
      });
      break;

    default:
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/** A sticker of either kind, rendered to its own square canvas. */
export function stickerCanvas(id, size, makeCanvas) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  if (id.startsWith('buddy:')) {
    const spec = companionById(id.slice(6));
    if (spec) drawCompanion(ctx, spec, 0, 0, size);
  } else {
    drawDeco(ctx, id.slice(5), 0, 0, size);
  }
  return c;
}

/* ============================================================ placement */

/** A newly tapped sticker lands centred, at a sensible size, slightly turned. */
export function newPlacement(id, index = 0) {
  const spread = [[0.5, 0.5], [0.32, 0.36], [0.70, 0.38], [0.34, 0.68], [0.68, 0.66]];
  const [x, y] = spread[index % spread.length];
  return {
    id,
    x, y,                                  // centre, fraction of the photo window
    scale: 0.26,                           // fraction of the window's larger side
    rot: (index % 2 ? 1 : -1) * 0.12,      // radians
    key: `${id}-${Date.now()}-${index}`,
  };
}

/**
 * Composite placed stickers into a photo window.
 *
 * @param {object} win  { x, y, w, h } in pixels — from meta.artWindow
 * @param {object} images { [stickerId]: Image } pre-rendered sticker canvases
 */
export function drawStickers(ctx, stickers, win, images) {
  if (!stickers?.length || !win) return;
  const base = Math.min(win.w, win.h);
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, win.x, win.y, win.w, win.h, win.r || 0);
  ctx.clip();

  for (const s of stickers) {
    const img = images[s.id];
    if (!img) continue;
    const size = base * (s.scale || 0.26);
    ctx.save();
    ctx.translate(win.x + s.x * win.w, win.y + s.y * win.h);
    ctx.rotate(s.rot || 0);
    // A soft drop shadow is what makes a flat sticker sit *on* the photo.
    ctx.shadowColor = 'rgba(0,0,0,.32)';
    ctx.shadowBlur = size * 0.10;
    ctx.shadowOffsetY = size * 0.03;
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  ctx.restore();
}

/** Hit test in photo-window fractions, topmost first. */
export function stickerAt(stickers, fx, fy, win) {
  const base = Math.min(win.w, win.h);
  for (let i = stickers.length - 1; i >= 0; i--) {
    const s = stickers[i];
    const size = base * (s.scale || 0.26);
    const hw = (size / 2) / win.w, hh = (size / 2) / win.h;
    // Generous box: fingers are imprecise and a missed grab feels broken.
    if (Math.abs(fx - s.x) < hw * 1.15 && Math.abs(fy - s.y) < hh * 1.15) return s;
  }
  return null;
}
