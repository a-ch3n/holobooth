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

/** Whichever of two rarities (either may be absent) sits higher in RARITY_ORDER. */
function higherRarity(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return RARITY_ORDER.indexOf(a) >= RARITY_ORDER.indexOf(b) ? a : b;
}

/**
 * The exact probability of pulling each rarity for a given boost/floor/
 * guarantee — read by the odds UI so what the customer is shown can never
 * drift from what rollRarity() actually does with the same inputs.
 *
 * atLeast(atLeast(picked, floor), guarantee) bumps anything below either
 * threshold up to it; applying two "at least" floors in sequence is the same
 * as applying one floor at whichever threshold is higher, so the probability
 * mass of every tier below that floor collapses onto the floor tier itself.
 */
export function rarityOdds({ boost = 1, floor = null, guarantee = null } = {}) {
  const entries = RARITY_ORDER.map(id => RARITIES[id]);
  const weights = entries.map((r, i) => {
    const tierUp = i / (entries.length - 1);
    return r.weight * Math.pow(boost, tierUp * 3);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const pct = weights.map(w => (w / total) * 100);

  const effFloor = higherRarity(floor, guarantee);
  const floorIdx = effFloor ? RARITY_ORDER.indexOf(effFloor) : -1;
  if (floorIdx > 0) {
    const bumped = pct.slice(0, floorIdx).reduce((a, b) => a + b, 0);
    for (let i = 0; i < floorIdx; i++) pct[i] = 0;
    pct[floorIdx] += bumped;
  }

  return RARITY_ORDER.map((id, i) => ({ ...rarityMeta(id), pct: pct[i] }));
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

/** Same path as roundRect(), but appended to whatever path is already open —
 *  roundRect() always starts with beginPath(), which would wipe out a
 *  previous sub-path instead of adding to it. */
function roundRectSubpath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Foil is drawn onto the print master. Real holographic sparkle needs
 * laminate film over the print (see README > Foil), but this layer is what
 * makes a plain dye-sub card still read as "I pulled something good".
 *
 * `artWindow`, when given, is punched out of the clip region *before* any
 * pattern is drawn — not erased afterwards, which would just leave a
 * transparent hole where the photo was. That keeps every foil treatment
 * (and the sparkle scatter) strictly on the frame/background: the customer's
 * own photo (and anything they've stuck onto it) is never tinted, swept,
 * blurred or otherwise touched by rarity.
 */
export function applyFoil(ctx, W, H, rarityId, seed = 1, artWindow = null) {
  const r = RARITIES[rarityId];
  if (!r) return;
  ctx.save();
  ctx.beginPath();
  roundRectSubpath(ctx, 0, 0, W, H, W * 0.05);
  if (artWindow) {
    roundRectSubpath(ctx, artWindow.x, artWindow.y, artWindow.w, artWindow.h, artWindow.r || 0);
    ctx.clip('evenodd');
  } else {
    ctx.clip();
  }

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
    // 'none' (Common): no foil pattern, but the rarity ring below still draws
    // — the frame itself has to communicate "common" as much as "legendary".
  }

  rarityFrame(ctx, W, H, rarityId, r.color);
  ctx.restore();
}

/**
 * The rarity ring — a border treatment layered over the card's own frame
 * design, independent of it, so rarity always reads at arm's length even for
 * templates that skip foil (or, at Common, have none). Thickness, layer count
 * and corner marks all scale with tier, so "impressive frame" tracks rarity
 * exactly rather than being eyeballed per foil type.
 */
function rarityFrame(ctx, W, H, rarityId, color) {
  const tier = Math.max(0, RARITY_ORDER.indexOf(rarityId));
  const span = Math.max(1, RARITY_ORDER.length - 1);
  const tierFrac = tier / span;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const rings = 1 + Math.round(tierFrac * 2); // common: 1 hairline → top tier: 3 nested rings
  for (let p = 0; p < rings; p++) {
    const g = p * W * 0.010;
    ctx.strokeStyle = alpha(color, 0.5 - p * 0.14);
    ctx.lineWidth = W * (0.008 + tierFrac * 0.018);
    roundRect(ctx, W * 0.006 + g, H * 0.004 + g, W - (W * 0.012 + g * 2), H - (H * 0.008 + g * 2), W * 0.05);
    ctx.stroke();
  }

  // The two rarest tiers earn corner flourishes — the unmistakable "this one
  // is different" tell, on top of everything the foil pattern already did.
  if (tierFrac >= 0.7) {
    const cr = W * (0.014 + tierFrac * 0.010);
    const pad = W * 0.032;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    [[pad, pad], [W - pad, pad], [pad, H - pad], [W - pad, H - pad]].forEach(([x, y]) => {
      starPath(ctx, x, y, cr, cr * 0.4, 4);
      ctx.fill();
    });
  }
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
