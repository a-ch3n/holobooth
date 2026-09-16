/**
 * energy.mjs — the type system.
 *
 * Fourteen energy types, each with a colour ramp, a hand-drawn glyph and a
 * place in the weakness/resistance chart. Everything visual about a creature
 * card derives from its type, which is why adding a card is a three-line JSON
 * entry rather than a design job.
 *
 * The glyphs are drawn as paths, not font characters. A card that prints a
 * tofu box where the fire symbol should be is a card you refund.
 */

import { TAU, roundRect, radGrad, shade, alpha } from './draw.mjs';

export const ENERGY = {
  ember:   { name: 'Fire',      base: '#e53935', light: '#ff9e9e', dark: '#8f1717', ink: '#4d0b0b', weak: 'wave',   resist: 'leaf'  },
  wave:    { name: 'Water',     base: '#2f80ed', light: '#9ac7ff', dark: '#174b9b', ink: '#092957', weak: 'volt',   resist: 'ember' },
  leaf:    { name: 'Grass',     base: '#43a047', light: '#a8df9b', dark: '#216326', ink: '#123b16', weak: 'ember',  resist: 'wave'  },
  volt:    { name: 'Lightning', base: '#f2c500', light: '#fff09a', dark: '#927500', ink: '#4b3c00', weak: 'stone',  resist: 'steel' },
  frost:   { name: 'Water',     base: '#4aa9e8', light: '#b9e5ff', dark: '#23658f', ink: '#123c58', weak: 'steel',  resist: 'wave'  },
  stone:   { name: 'Fighting',  base: '#a76532', light: '#e0b084', dark: '#633617', ink: '#351a0a', weak: 'leaf',   resist: 'volt'  },
  gale:    { name: 'Colorless', base: '#c7cbd1', light: '#f2f4f6', dark: '#747b85', ink: '#343940', weak: 'volt',   resist: 'stone' },
  shade:   { name: 'Darkness',  base: '#34363d', light: '#777b86', dark: '#17181d', ink: '#fff',    weak: 'radiant', resist: 'psy' },
  radiant: { name: 'Fairy',     base: '#e889b5', light: '#ffd1e4', dark: '#914366', ink: '#4c1731', weak: 'steel',  resist: 'shade' },
  toxin:   { name: 'Psychic',   base: '#bd68c9', light: '#edb7ee', dark: '#6c2d76', ink: '#35133b', weak: 'psy',    resist: 'leaf'  },
  steel:   { name: 'Metal',     base: '#9da5ae', light: '#e0e4e8', dark: '#59616a', ink: '#2d3339', weak: 'ember',  resist: 'radiant' },
  psy:     { name: 'Psychic',   base: '#c05bc2', light: '#efafe7', dark: '#6b2b70', ink: '#351238', weak: 'shade',  resist: 'toxin' },
  wyrm:    { name: 'Colorless', base: '#d5d8dc', light: '#f7f8f9', dark: '#7c8188', ink: '#373b40', weak: 'wyrm',   resist: null    },
  plain:   { name: 'Colorless', base: '#e1e3e6', light: '#fff', dark: '#8c9299', ink: '#3b3f44', weak: 'stone', resist: 'shade' },
};

export const ENERGY_IDS = Object.keys(ENERGY);

export function energy(id) {
  return ENERGY[id] || ENERGY.plain;
}

/* ---------------------------------------------------------------- glyphs */

/**
 * Draw one type glyph centred at (cx, cy) with radius r, in the given colour.
 * Paths only — sized relative to r so the same code draws a 9px attack pip and
 * a 60px full-art badge.
 */
export function energyGlyph(ctx, id, cx, cy, r, color = '#fff') {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (id) {
    case 'ember': { // flame
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.bezierCurveTo(cx + r * .78, cy - r * .18, cx + r * .62, cy + r * .86, cx, cy + r * .92);
      ctx.bezierCurveTo(cx - r * .62, cy + r * .86, cx - r * .78, cy - r * .18, cx, cy - r);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'wave': { // droplet
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.bezierCurveTo(cx + r * .95, cy + r * .05, cx + r * .68, cy + r, cx, cy + r);
      ctx.bezierCurveTo(cx - r * .68, cy + r, cx - r * .95, cy + r * .05, cx, cy - r);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'leaf': {
      ctx.beginPath();
      ctx.moveTo(cx - r * .8, cy + r * .8);
      ctx.bezierCurveTo(cx - r * .9, cy - r * .6, cx + r * .3, cy - r, cx + r * .85, cy - r * .8);
      ctx.bezierCurveTo(cx + r * .95, cy + r * .1, cx + r * .1, cy + r * .95, cx - r * .8, cy + r * .8);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'volt': { // bolt
      ctx.beginPath();
      ctx.moveTo(cx + r * .35, cy - r);
      ctx.lineTo(cx - r * .55, cy + r * .12);
      ctx.lineTo(cx - r * .02, cy + r * .12);
      ctx.lineTo(cx - r * .3, cy + r);
      ctx.lineTo(cx + r * .6, cy - r * .18);
      ctx.lineTo(cx + r * .05, cy - r * .18);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'frost': { // six-spoke snowflake
      ctx.lineWidth = r * .2;
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
      }
      break;
    }
    case 'stone': { // faceted hexagon
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 6;
        const p = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
        i ? ctx.lineTo(...p) : ctx.moveTo(...p);
      }
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'gale': { // wing swoosh
      ctx.lineWidth = r * .26;
      ctx.beginPath();
      ctx.moveTo(cx - r, cy + r * .3);
      ctx.quadraticCurveTo(cx, cy - r * 1.05, cx + r, cy - r * .1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r * .55, cy + r * .82);
      ctx.quadraticCurveTo(cx + r * .1, cy + r * .1, cx + r * .95, cy + r * .5);
      ctx.stroke();
      break;
    }
    case 'shade': { // crescent
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.arc(cx + r * .48, cy - r * .3, r * .88, 0, TAU, true);
      ctx.fill('evenodd');
      break;
    }
    case 'radiant': { // four-point sparkle
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 4;
        const b = a + Math.PI / 4;
        const p = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
        i ? ctx.lineTo(...p) : ctx.moveTo(...p);
        ctx.lineTo(cx + Math.cos(b) * r * .26, cy + Math.sin(b) * r * .26);
      }
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'toxin': { // three bubbles
      [[0, -.45, .5], [-.5, .42, .42], [.52, .4, .36]].forEach(([dx, dy, rr]) => {
        ctx.beginPath(); ctx.arc(cx + dx * r, cy + dy * r, rr * r, 0, TAU); ctx.fill();
      });
      break;
    }
    case 'steel': { // gear
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8;
        const rr = i % 2 ? r * .66 : r;
        const a2 = a + TAU / 16;
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        ctx.lineTo(cx + Math.cos(a2) * rr, cy + Math.sin(a2) * rr);
      }
      ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(cx, cy, r * .3, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'psy': { // spiral
      ctx.lineWidth = r * .22;
      ctx.beginPath();
      for (let t = 0; t < TAU * 1.6; t += 0.12) {
        const rr = r * (0.12 + (t / (TAU * 1.6)) * 0.88);
        const p = [cx + Math.cos(t) * rr, cy + Math.sin(t) * rr];
        t ? ctx.lineTo(...p) : ctx.moveTo(...p);
      }
      ctx.stroke();
      break;
    }
    case 'wyrm': { // scale diamond
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.quadraticCurveTo(cx + r * .55, cy, cx, cy + r);
      ctx.quadraticCurveTo(cx - r * .55, cy, cx, cy - r);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * .55);
      ctx.quadraticCurveTo(cx + r * .95, cy, cx, cy + r * .55);
      ctx.quadraticCurveTo(cx - r * .95, cy, cx, cy - r * .55);
      ctx.closePath(); ctx.fill();
      break;
    }
    default: { // plain — ring
      ctx.lineWidth = r * .34;
      ctx.beginPath(); ctx.arc(cx, cy, r * .72, 0, TAU); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/**
 * A full energy pip: the coloured disc plus its glyph. This is the unit that
 * appears in attack costs, the HP badge and the weakness footer.
 */
export function energyPip(ctx, id, cx, cy, r, { flat = false } = {}) {
  const e = energy(id);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = flat
    ? e.base
    : radGrad(ctx, cx - r * .35, cy - r * .4, 0, r * 1.5, [[0, e.light], [0.55, e.base], [1, e.dark]]);
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.13);
  ctx.strokeStyle = 'rgba(255,255,255,.75)';
  ctx.stroke();
  ctx.restore();
  energyGlyph(ctx, id, cx, cy, r * 0.56, alpha(e.ink, 0.92));
}

/** Row of cost pips for one attack. Returns the width consumed. */
export function costRow(ctx, cost, x, y, r) {
  const list = Array.isArray(cost) ? cost : [];
  list.forEach((t, i) => energyPip(ctx, t, x + r + i * (r * 2.25), y, r));
  return list.length ? list.length * (r * 2.25) : 0;
}

/** Weakness / resistance cell: a small pip plus its multiplier. */
export function typeCell(ctx, id, text, x, y, r, color, fontStr) {
  if (!id) {
    ctx.save(); ctx.fillStyle = color; ctx.font = fontStr;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('—', x, y); ctx.restore();
    return r * 2;
  }
  energyPip(ctx, id, x + r, y, r);
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = fontStr;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + r * 2.4, y);
  const w = r * 2.4 + ctx.measureText(text).width;
  ctx.restore();
  return w;
}
