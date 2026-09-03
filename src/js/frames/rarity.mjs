/**
 * rarity.mjs — the collectibility layer.
 *
 * Two jobs:
 *   1. Decide what a customer pulled (weighted roll, with product boosts,
 *      per-frame floors and pity guarantees).
 *   2. Make that pull *visible* — foil treatments printed onto the card.
 *
 * Everything is seeded, so re-printing serial S1-2026-0412 twelve months from
 * now produces a byte-identical card.
 */

import { RARITIES, RARITY_ORDER } from './packs.mjs';
import { holoSweep, foilLines, roundRect, alpha, radGrad, starPath, TAU } from './draw.mjs';

/* --------------------------------------------------------------- random */

/** mulberry32 — small, fast, and identical in node and the browser. */
export function seededRng(seed) {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ----------------------------------------------------------------- roll */

/**
 * @param {object} opts
 * @param {number} opts.boost       product rarityBoost (1.0 = base odds)
 * @param {string} opts.floor       frame's rarityFloor — never rolls below this
 * @param {string} opts.guarantee   product guaranteeAtLeast, applied to a pack
 * @param {function} opts.rng
 */
export function rollRarity({ boost = 1, floor = null, guarantee = null, rng = Math.random } = {}) {
  const entries = RARITY_ORDER.map(id => RARITIES[id]);
  // Boost shifts weight from common toward the top end without ever making
  // secret rares cheap — the exponent keeps the tail thin.
  const weights = entries.map((r, i) => {
    const tierUp = i / (entries.length - 1);
    return r.weight * Math.pow(boost, tierUp * 3);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng() * total;
  let picked = entries[0].id;
  for (let i = 0; i < entries.length; i++) {
    if ((x -= weights[i]) <= 0) { picked = entries[i].id; break; }
  }
  return atLeast(atLeast(picked, floor), guarantee);
}

export function atLeast(id, min) {
  if (!min) return id;
  return RARITY_ORDER.indexOf(id) >= RARITY_ORDER.indexOf(min) ? id : min;
}

/** Booster packs: roll N cards, then upgrade one if the guarantee wasn't met. */
export function rollPack(count, opts = {}) {
  const rolls = Array.from({ length: count }, () => rollRarity(opts));
  const g = opts.guarantee;
  if (g && !rolls.some(r => RARITY_ORDER.indexOf(r) >= RARITY_ORDER.indexOf(g))) {
    const rng = opts.rng || Math.random;
    rolls[Math.floor(rng() * rolls.length)] = g;
  }
  return rolls;
}

/* ----------------------------------------------------------------- foil */

/**
 * Foil is drawn onto the print master. Real holographic sparkle needs
 * laminate film over the print (see README > Foil), but this layer is what
 * makes a plain dye-sub card still read as "I pulled something good".
 */
export function applyFoil(ctx, W, H, rarityId, seed = 1) {
  const r = RARITIES[rarityId];
  if (!r || r.foil === 'none') return;
  ctx.save();
  roundRect(ctx, 0, 0, W, H, W * 0.05);
  ctx.clip();

  switch (r.foil) {
    case 'satin':
      holoSweep(ctx, 0, 0, W, H, 0.07, 0.9, 3);
      foilLines(ctx, 0, 0, W, H, W * 0.02, 0.05, -0.6);
      break;

    case 'holo':
      holoSweep(ctx, 0, 0, W, H, 0.16, 0.7, 5);
      foilLines(ctx, 0, 0, W, H, W * 0.012, 0.09, -0.55);
      sparkles(ctx, W, H, 22, seed, 0.5);
      break;

    case 'rainbow':
      holoSweep(ctx, 0, 0, W, H, 0.19, 0.55, 7);
      foilLines(ctx, 0, 0, W, H, W * 0.008, 0.13, -0.5);
      // cross-hatch second pass gives the "textured rainbow" look
      foilLines(ctx, 0, 0, W, H, W * 0.02, 0.08, 0.9);
      sparkles(ctx, W, H, 36, seed, 0.62);
      break;

    case 'gold': {
      ctx.globalCompositeOperation = 'overlay';
      const g = ctx.createLinearGradient(0, 0, W, H);
      [[0, 'rgba(255,214,110,.42)'], [0.28, 'rgba(255,247,214,.58)'],
       [0.5, 'rgba(198,146,32,.34)'], [0.72, 'rgba(255,240,190,.54)'],
       [1, 'rgba(150,105,18,.36)']].forEach(([o, c]) => g.addColorStop(o, c));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      foilLines(ctx, 0, 0, W, H, W * 0.006, 0.09, -0.45);
      sparkles(ctx, W, H, 46, seed, 0.7);
      break;
    }
  }

  // rarity-tinted edge glow, so the treatment reads even at arm's length
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = alpha(r.color, 0.5);
  ctx.lineWidth = W * 0.012;
  roundRect(ctx, W * 0.006, H * 0.004, W - W * 0.012, H - H * 0.008, W * 0.05);
  ctx.stroke();
  ctx.restore();
}

/**
 * The holofoil art box: a prismatic pattern laid *inside the art window only*,
 * which is the oldest and most recognisable tell that a card is a holo. Applied
 * under the frame so the border stays flat and the picture shimmers.
 */
export function artBoxHolo(ctx, x, y, w, h, rarityId, seed = 1) {
  const r = RARITIES[rarityId];
  if (!r || r.foil === 'none' || r.foil === 'satin') return;
  const strength = { holo: 0.26, rainbow: 0.34, gold: 0.30 }[r.foil] || 0.2;

  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.globalCompositeOperation = 'overlay';

  // Interference "starfield" — overlapping soft prismatic lozenges.
  const rng = seededRng(seed ^ 0x5f3a);
  for (let i = 0; i < 46; i++) {
    const cx = x + rng() * w, cy = y + rng() * h;
    const rr = (0.06 + rng() * 0.20) * Math.min(w, h);
    const hue = r.foil === 'gold' ? 40 + rng() * 25 : rng() * 360;
    ctx.globalAlpha = strength * (0.35 + rng() * 0.65);
    ctx.fillStyle = radGrad(ctx, cx, cy, 0, rr,
      [[0, `hsla(${hue},95%,72%,1)`], [0.6, `hsla(${(hue + 40) % 360},90%,64%,.45)`], [1, 'hsla(0,0%,100%,0)']]);
    ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.62, rng() * Math.PI, 0, TAU); ctx.fill();
  }

  // Directional sweep across the whole box ties the lozenges together.
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'screen';
  const g = ctx.createLinearGradient(x, y + h, x + w, y);
  const stops = r.foil === 'gold'
    ? [[0, 'rgba(255,226,150,.20)'], [0.5, 'rgba(255,250,225,.26)'], [1, 'rgba(198,150,40,.20)']]
    : [[0, 'rgba(120,220,255,.16)'], [0.3, 'rgba(200,140,255,.16)'], [0.6, 'rgba(255,160,205,.14)'], [1, 'rgba(160,255,215,.16)']];
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function sparkles(ctx, W, H, count, seed, strength) {
  const rng = seededRng(seed * 7919 + count);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < count; i++) {
    const x = rng() * W, y = rng() * H;
    const s = (0.004 + rng() * 0.014) * W;
    ctx.globalAlpha = (0.25 + rng() * 0.5) * strength;
    ctx.fillStyle = radGrad(ctx, x, y, 0, s * 2.2,
      [[0, '#ffffff'], [0.4, 'rgba(255,255,255,.5)'], [1, 'rgba(255,255,255,0)']]);
    ctx.beginPath(); ctx.arc(x, y, s * 2.2, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    starPath(ctx, x, y, s, s * 0.16, 4, rng() * TAU);
    ctx.fill();
  }
  ctx.restore();
}

/* --------------------------------------------------------------- serial */

/** e.g. "S1-2026 · DUE-SHA #0412/0500" */
export function makeSerial({ seasonId, frameId, mint, mintLimit }) {
  const code = frameId.split('-').map(p => p.slice(0, 3).toUpperCase()).join('-');
  const pad = String(mintLimit || 9999).length;
  const n = String(mint).padStart(pad, '0');
  return mintLimit ? `${code} #${n}/${mintLimit}` : `${code} #${n}`;
}

export function rarityMeta(id) {
  const r = RARITIES[id] || RARITIES.common;
  return { rarity: r.id, rarityLabel: r.label, raritySymbol: r.symbol, rarityColor: r.color, foil: r.foil };
}

export { RARITIES, RARITY_ORDER };
