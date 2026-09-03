/**
 * templates.mjs — the three creature-card layouts, plus the photo strip.
 *
 * Templates own layout. The catalogue owns colour, copy and stats, and colour
 * comes from the card's energy type — so a new Pal is a JSON entry, never a
 * design job.
 *
 * All coordinates derive from W/H, so the same code renders a 250px picker
 * thumbnail and a 750x1050 300dpi print master.
 */

import {
  roundRect, notchRect, scallopRect, heartPath, confetti,
  linGrad, radGrad, shade, alpha, bevel, inset,
  fitText, paragraph, measureParagraph, grain, drawCover, clipped, withShadow, font, starPath, TAU,
} from './draw.mjs';
import { energy, energyPip, energyGlyph, costRow, typeCell } from './energy.mjs';
import { artBoxHolo } from './rarity.mjs';
import { companionBadge } from './companions.mjs';
import { drawAssetCard } from './assetpack.mjs';

/** Rarity pips are glyphs a display font often lacks; always draw them from a
 *  stack that carries them, or a paid-for card prints a tofu box. */
const SYMBOL_FONT = '"DejaVu Sans", "Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols 2", sans-serif';

/* =============================================================== shared */

function cardBase(ctx, W, H, fill) {
  ctx.save();
  roundRect(ctx, 0, 0, W, H, W * 0.05);
  ctx.clip();
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/**
 * The card stock itself. A trading card reads as a trading card largely because
 * of this: a wide metallic border with visible grain and a fine diffraction
 * texture, not a flat colour fill.
 */
function cardStock(ctx, W, H, stock, e) {
  const ramps = {
    // Metallic foil stock — subtle gradient, reads as printed foil.
    gold: [[0, '#fbeaa8'], [0.16, '#e9c454'], [0.38, '#f7e08d'], [0.55, '#d4a52c'],
           [0.74, '#f3dd93'], [0.9, '#c99a24'], [1, '#eccd66']],
    silver: [[0, '#f4f7fb'], [0.18, '#c3cad6'], [0.4, '#eef2f7'], [0.58, '#a8b1c0'],
             [0.78, '#e3e8f0'], [1, '#b6bfcc']],
    // Flat saturated yellow board stock — the bright, toy-shelf look of a
    // classic sports or game card. Much less gradient than the foil ramps;
    // the point is that it reads as solid colour at arm's length.
    classic: [[0, '#ffdf5c'], [0.30, '#ffd12e'], [0.55, '#fcc51c'], [0.80, '#ffd83f'], [1, '#f5bd12']],
  };
  cardBase(ctx, W, H, stock === 'type' ? e.base : stock === 'classic' ? '#fcc51c' : '#e3c05a');
  ctx.save();
  roundRect(ctx, 0, 0, W, H, W * 0.05);
  ctx.clip();

  if (stock === 'type') {
    ctx.fillStyle = linGrad(ctx, 0, 0, W * 0.6, H, [
      [0, shade(e.light, 0.10)], [0.4, e.base], [0.72, shade(e.base, -0.12)], [1, shade(e.light, -0.02)],
    ]);
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = linGrad(ctx, 0, 0, W * 0.75, H, ramps[stock] || ramps.gold);
    ctx.fillRect(0, 0, W, H);
    // Foil stock gets brushed diffraction lines; flat board stock does not —
    // that texture is what separates "metallic" from "printed cardboard".
    if (stock !== 'classic') foilLinesLocal(ctx, 0, 0, W, H, W * 0.012, 0.055, -0.42);
  }
  grain(ctx, 0, 0, W, H, stock === 'classic' ? 0.028 : 0.045, 3);
  // top-left light, bottom-right shade: the card has a thickness
  ctx.fillStyle = linGrad(ctx, 0, 0, W, H, stock === 'classic'
    ? [[0, 'rgba(255,255,255,.16)'], [0.55, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,.10)']]
    : [[0, 'rgba(255,255,255,.22)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,.18)']]);
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Local copy of the foil ridge pass, clipped by the caller. */
function foilLinesLocal(ctx, x, y, w, h, spacing, strength, angle) {
  ctx.save();
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

/**
 * A recessed art window: dark well, metallic inner frame, then the picture.
 * Three strokes instead of one is the whole difference between "image with a
 * border" and "window cut into a card".
 */
function artWell(ctx, x, y, w, h, W, t, stock) {
  const r = W * 0.012;
  // outer shadow / recess
  withShadow(ctx, 'rgba(0,0,0,.45)', W * 0.022, 0, W * 0.004, cc => {
    cc.fillStyle = '#2a2418';
    roundRect(cc, x, y, w, h, r); cc.fill();
  });
  // metallic inner frame
  const fw = W * 0.010;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = stock === 'silver'
    ? linGrad(ctx, x, y, x + w, y + h, [[0, '#fdfefe'], [0.4, '#9aa3b2'], [0.7, '#e8edf4'], [1, '#7f8794']])
    : stock === 'classic'
    ? linGrad(ctx, x, y, x + w, y + h, [[0, '#fff6d0'], [0.35, '#d8a827'], [0.68, '#ffeeae'], [1, '#b98c12']])
    : linGrad(ctx, x, y, x + w, y + h, [[0, '#fff3c4'], [0.35, '#c9992a'], [0.65, '#ffeeb0'], [1, '#a97f18']]);
  ctx.lineWidth = fw;
  ctx.stroke();
  ctx.restore();
  return { x: x + fw * 0.6, y: y + fw * 0.6, w: w - fw * 1.2, h: h - fw * 1.2, r: r * 0.6 };
}

/** Illustrator credit + set symbol + collector number, the line under the art. */
function creditLine(ctx, frame, meta, x, y, w, W, t, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = font(600, W * 0.020, t.fontBody);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Illus. ${frame.artist || meta.boothName}`, x, y);

  ctx.textAlign = 'right';
  ctx.fillText(frame.collectorNumber || '', x + w, y);
  const numW = ctx.measureText(frame.collectorNumber || '').width;
  // set symbol: a small filled star in the rarity colour
  const sr = W * 0.012;
  starPath(ctx, x + w - numW - sr * 2.2, y - sr * 0.5, sr, sr * 0.45, 6);
  ctx.fillStyle = meta.rarityColor;
  ctx.fill();
  ctx.restore();
}

/** The small print along the bottom edge. Real cards have it; fakes forget it. */
function fineprint(ctx, W, H, frame, meta, y, color, family) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.75;
  ctx.font = font(500, W * 0.0165, family);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(`© ${new Date(meta.mintedAt || Date.now()).getFullYear()} ${meta.boothName} · ${meta.setName}`, W * 0.068, y);
  ctx.textAlign = 'right';
  ctx.fillText(meta.serial, W - W * 0.068, y);
  ctx.restore();
}

function photoWindow(ctx, img, x, y, w, h, r, focal) {
  clipped(ctx, c => roundRect(c, x, y, w, h, r), c => {
    c.fillStyle = '#11131a';
    c.fillRect(x, y, w, h);
    if (img) drawCover(c, img, x, y, w, h, focal);
  });
}

/** Hand-drawn promo character, composited beside the photo. */
function drawCharacter(ctx, frame, character, x, y, w, h, W) {
  if (!character) return;
  const cs = (frame.character?.scale || 0.4) * W;
  const ch = cs * ((character.height / character.width) || 1);
  const anchor = frame.character?.anchor || 'bottom-right';
  const cx = anchor.includes('left') ? x - cs * 0.18 : x + w - cs * 0.82;
  const cy = y + h - ch * 0.88;
  withShadow(ctx, 'rgba(0,0,0,.32)', W * 0.03, 0, W * 0.008, cc => {
    cc.drawImage(character, cx, cy, cs, ch);
  });
}

/** Collector number, rarity and set code — the line collectors actually read. */
function collectorRow(ctx, W, H, frame, meta, color, family, y) {
  const s = W * 0.026;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.textBaseline = 'alphabetic';

  ctx.font = font(700, s, family);
  ctx.textAlign = 'left';
  ctx.fillText(frame.collectorNumber || meta.serial, W * 0.068, y);

  ctx.font = font(500, s * 0.92, family);
  ctx.globalAlpha = 0.6;
  ctx.fillText(`  ·  ${meta.serial}`, W * 0.068 + ctx.measureText(frame.collectorNumber || '').width * 1.02, y);

  ctx.globalAlpha = 0.9;
  ctx.textAlign = 'right';
  ctx.font = font(700, s, family);
  ctx.fillText(meta.rarityLabel, W - W * 0.068, y);
  const lw = ctx.measureText(meta.rarityLabel).width;
  ctx.font = font(700, s, SYMBOL_FONT);
  ctx.fillText(meta.raritySymbol, W - W * 0.068 - lw - W * 0.012, y);
  ctx.restore();
}

/** Stage badge: "BASIC" / "STAGE 1 · Evolves from Emberling" */
function stageBadge(ctx, frame, x, y, W, H, t) {
  const bh = H * 0.024;
  const label = String(frame.stage || 'Basic').toUpperCase();
  ctx.save();
  ctx.font = font(800, bh * 0.66, t.fontBody);
  const bw = ctx.measureText(label).width + W * 0.036;
  ctx.fillStyle = alpha(t.borderDark, 0.16);
  roundRect(ctx, x, y, bw, bh, bh / 2); ctx.fill();
  ctx.fillStyle = t.plateText;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + bw / 2, y + bh * 0.54);

  if (frame.evolvesFrom) {
    // A small pre-evolution marker, the way a real evolution box carries a
    // thumbnail of what the card came from.
    const pr = bh * 0.46;
    const px = x + bw + W * 0.016 + pr;
    ctx.save();
    ctx.beginPath(); ctx.arc(px, y + bh * 0.5, pr * 1.18, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fill();
    ctx.strokeStyle = alpha(t.plateText, 0.35); ctx.lineWidth = W * 0.0022; ctx.stroke();
    ctx.restore();
    energyPip(ctx, frame.energyType, px, y + bh * 0.5, pr * 0.86);

    ctx.textAlign = 'left';
    ctx.font = font(600, bh * 0.6, t.fontBody);
    ctx.fillStyle = alpha(t.plateText, 0.68);
    ctx.fillText(`evolves from ${frame.evolvesFrom}`, px + pr * 1.6, y + bh * 0.54);
  }
  ctx.restore();
  return bh;
}

/** HP block + type pip, right-aligned. */
function hpBlock(ctx, frame, rightX, baselineY, W, t, scale = 1) {
  const pipR = W * 0.030 * scale;
  const pipX = rightX - pipR;
  energyPip(ctx, frame.energyType, pipX, baselineY - pipR * 0.35, pipR);

  ctx.save();
  ctx.textAlign = 'right';
  ctx.fillStyle = t.plateText;
  ctx.font = font(900, W * 0.058 * scale, t.fontDisplay);
  const hp = String(frame.hp);
  ctx.fillText(hp, pipX - pipR - W * 0.014, baselineY);
  const hpW = ctx.measureText(hp).width;
  ctx.font = font(800, W * 0.024 * scale, t.fontBody);
  ctx.fillText('HP', pipX - pipR - W * 0.014 - hpW - W * 0.008, baselineY - W * 0.005 * scale);
  ctx.restore();
  return pipR;
}

/** Ability box: coloured tab, name, rules text. Returns the y after it. */
function abilityBox(ctx, ability, x, y, w, W, H, t, onDark = false) {
  if (!ability) return y;
  const tabH = H * 0.026;
  ctx.save();
  ctx.font = font(800, tabH * 0.62, t.fontBody);
  const tw = ctx.measureText('ABILITY').width + W * 0.03;
  ctx.fillStyle = t.border;
  roundRect(ctx, x, y, tw, tabH, tabH * 0.3); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('ABILITY', x + tw / 2, y + tabH * 0.55);

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = onDark ? '#fff' : t.borderDark;
  fitText(ctx, ability.name, x + tw + W * 0.018, y + tabH * 0.78, w - tw - W * 0.03, W * 0.036, 800, t.fontDisplay);
  ctx.restore();

  ctx.fillStyle = alpha(onDark ? '#ffffff' : t.textboxText, 0.9);
  return paragraph(ctx, ability.text, x, y + tabH + H * 0.006, w,
    W * 0.028, W * 0.036, 400, t.fontBody, 2) + H * 0.008;
}

/**
 * How tall the ability + attacks block will be. Measured rather than guessed,
 * so the body can be centred in the space between the art and the flavour
 * text — otherwise a Pal with one attack leaves a third of the card empty.
 */
function measureBody(ctx, c, w, W, H, t, { scale = 1, maxAttacks = 99 } = {}) {
  let h = 0;
  if (c.ability) {
    h += H * 0.026 + H * 0.006;
    h += measureParagraph(ctx, c.ability.text, w, W * 0.028, W * 0.036, 400, t.fontBody, 2);
    h += H * 0.008;
  }
  const list = (c.attacks || []).slice(0, maxAttacks);
  list.forEach((atk, i) => {
    const er = W * 0.020 * scale;
    h += er * 1.6;
    if (atk.text) {
      const nx = Math.max(atk.cost.length * (er * 2.25), er * 2) + W * 0.014;
      h += measureParagraph(ctx, atk.text, w - nx - W * 0.10, W * 0.027 * scale, W * 0.034 * scale, 400, t.fontBody, 2);
      h += H * 0.010;
    } else h += er * 0.6;
    if (i < list.length - 1) h += H * 0.014;
  });
  return h;
}

/** One attack row. Returns the y after it. */
function attackRow(ctx, atk, x, y, w, W, H, t, { onDark = false, scale = 1 } = {}) {
  const er = W * 0.020 * scale;
  const costW = costRow(ctx, atk.cost, x, y + er * 0.7, er);
  const nx = x + Math.max(costW, er * 2) + W * 0.014;

  ctx.fillStyle = onDark ? '#ffffff' : t.textboxText;
  fitText(ctx, atk.name, nx, y + er * 1.25, w * 0.52, W * 0.043 * scale, 800, t.fontDisplay);

  ctx.save();
  ctx.textAlign = 'right';
  ctx.font = font(900, W * 0.052 * scale, t.fontDisplay);
  ctx.fillStyle = onDark ? '#ffffff' : t.textboxText;
  ctx.fillText(String(atk.dmg), x + w, y + er * 1.3);
  ctx.restore();

  if (!atk.text) return y + er * 2.2;
  ctx.fillStyle = alpha(onDark ? '#ffffff' : t.textboxText, 0.78);
  return paragraph(ctx, atk.text, nx, y + er * 1.6, w - (nx - x) - W * 0.10,
    W * 0.027 * scale, W * 0.034 * scale, 400, t.fontBody, 2) + H * 0.010;
}

/** Weakness / resistance / retreat strip. */
function typeFooter(ctx, footer, x, y, w, W, H, t, onDark = false) {
  const h = H * 0.032;
  const r = h * 0.30;
  const inkHex = onDark ? '#ffffff' : t.textboxText;
  const ink = alpha(inkHex, 0.92);
  ctx.save();
  ctx.fillStyle = onDark ? 'rgba(255,255,255,.10)' : alpha(t.border, 0.12);
  roundRect(ctx, x, y, w, h, h * 0.26); ctx.fill();

  const f = font(700, W * 0.024, t.fontBody);
  const label = font(600, W * 0.019, t.fontBody);
  const cy = y + h / 2;
  const cells = [
    ['weakness', footer.weakness, footer.weaknessText],
    ['resists', footer.resistance, footer.resistanceText],
  ];
  let cx = x + W * 0.022;
  cells.forEach(([lab, type, txt]) => {
    ctx.fillStyle = alpha(inkHex, 0.62);
    ctx.font = label;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(lab, cx, cy);
    cx += ctx.measureText(lab).width + W * 0.012;
    cx += typeCell(ctx, type, txt, cx, cy, r, ink, f) + W * 0.026;
  });

  // retreat cost as plain pips
  ctx.fillStyle = alpha(inkHex, 0.62);
  ctx.font = label;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const n = footer.retreat || 0;
  const pipsW = n * (r * 2.2);
  ctx.fillText('retreat', x + w - W * 0.022 - pipsW - W * 0.010, cy);
  for (let i = 0; i < n; i++) energyPip(ctx, 'plain', x + w - W * 0.022 - pipsW + r + i * (r * 2.2), cy, r);
  ctx.restore();
  return y + h;
}

/** Shiny marker — the little star that tells a collector to look twice. */
function shinyMark(ctx, x, y, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  starPath(ctx, x, y, r, r * 0.4, 4, -Math.PI / 2);
  ctx.fill();
  ctx.globalAlpha = 0.7;
  starPath(ctx, x + r * 1.2, y + r * 0.9, r * 0.45, r * 0.18, 4, -Math.PI / 2);
  ctx.fill();
  ctx.restore();
}

/* ============================================================= CREATURE */

export function creature(ctx, o) {
  const { W, H, frame, photo, meta, character } = o;
  const t = frame.theme, c = frame.content;
  const e = energy(t.type);
  const stock = o.stock || frame.stock || 'gold';

  /* ---- card stock */
  cardStock(ctx, W, H, stock, e);

  /* ---- dark keyline, then the type-tinted card face */
  const m = W * 0.058;
  ctx.save();
  roundRect(ctx, m * 0.72, m * 0.72, W - m * 1.44, H - m * 1.44, W * 0.024);
  ctx.strokeStyle = stock === 'classic' ? 'rgba(56,42,8,.68)' : 'rgba(40,32,12,.55)';
  ctx.lineWidth = W * (stock === 'classic' ? 0.0075 : 0.006);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  roundRect(ctx, m, m, W - m * 2, H - m * 2, W * 0.020);
  ctx.clip();
  ctx.fillStyle = stock === 'classic' ? '#fffdf4' : t.textbox;
  ctx.fillRect(m, m, W - m * 2, H - m * 2);
  // faint type wash from the top, so the face belongs to its element
  ctx.fillStyle = linGrad(ctx, 0, m, 0, H * 0.62,
    [[0, alpha(e.light, stock === 'classic' ? 0.68 : 0.55)], [1, alpha(e.light, 0.06)]]);
  ctx.fillRect(m, m, W - m * 2, H - m * 2);
  grain(ctx, m, m, W - m * 2, H - m * 2, 0.035, 21);
  ctx.restore();

  const ix = m + W * 0.020, iw = W - ix * 2;

  /* ---- header: stage badge, name, HP */
  const badgeY = m + H * 0.014;
  stageBadge(ctx, frame, ix, badgeY, W, H, t);
  const nameY = badgeY + H * 0.056;
  ctx.fillStyle = t.plateText;
  fitText(ctx, meta.personal?.provided ? meta.personal.name : frame.name,
    ix, nameY, iw * 0.56, W * 0.060, 800, t.fontDisplay);
  hpBlock(ctx, frame, ix + iw, nameY, W, t);
  if (c.shiny) shinyMark(ctx, ix + iw * 0.60, nameY - W * 0.030, W * 0.020, '#e8b923');

  /* ---- art window */
  const awY = nameY + H * 0.014, awH = H * 0.352;
  const win = artWell(ctx, ix, awY, iw, awH, W, t, stock);
  meta.artWindow = { ...win };
  photoWindow(ctx, photo, win.x, win.y, win.w, win.h, win.r, meta.focal);
  drawCharacter(ctx, frame, character, win.x, win.y, win.w, win.h, W);
  // Holofoil lives INSIDE the art box — the classic tell.
  if (meta.rarity) artBoxHolo(ctx, win.x, win.y, win.w, win.h, meta.rarity, meta.seed || 1);
  inset(ctx, win.x, win.y, win.w, win.h, win.r, 0.85);

  creditLine(ctx, frame, meta, ix, awY + awH + H * 0.020, iw, W, t, alpha(t.textboxText, 0.55));

  /* ---- body: ability, then attacks, centred in the space they have */
  const bodyTop = awY + awH + H * 0.034;
  const footerY = H - m - H * 0.090;
  const bandBottom = footerY - (c.flavor ? H * 0.050 : H * 0.014);
  const blockH = measureBody(ctx, c, iw, W, H, t);
  let by = bodyTop + Math.max(0, (bandBottom - bodyTop - blockH) * 0.34);

  by = abilityBox(ctx, c.ability, ix, by, iw, W, H, t);
  (c.attacks || []).forEach((atk, i) => {
    if (by > bandBottom - H * 0.03) return;
    if (i) {
      ctx.save();
      ctx.strokeStyle = alpha(t.textboxText, 0.16);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ix + W * 0.02, by - H * 0.007);
      ctx.lineTo(ix + iw - W * 0.02, by - H * 0.007);
      ctx.stroke();
      ctx.restore();
      by += H * 0.007;
    }
    by = attackRow(ctx, atk, ix, by, iw, W, H, t);
  });

  if (c.flavor) {
    ctx.save();
    ctx.fillStyle = alpha(t.textboxText, 0.62);
    paragraph(ctx, c.flavor, ix, footerY - H * 0.038, iw, W * 0.024, W * 0.030, 400, t.fontBody, 2);
    ctx.restore();
  }

  typeFooter(ctx, c.footer, ix, footerY, iw, W, H, t);
  collectorRow(ctx, W, H, frame, meta, alpha(t.textboxText, 0.85), t.fontBody, H - m - H * 0.026);
  fineprint(ctx, W, H, frame, meta, H - m * 0.34, t.textboxText, t.fontBody);
}

/* ========================================================== CREATURE MAX */

export function creatureMax(ctx, o) {
  const { W, H, frame, photo, meta, character } = o;
  const t = frame.theme, c = frame.content;
  const e = energy(t.type);

  // Two-tone silver-over-type frame: the MAX card's tell at three feet.
  cardStock(ctx, W, H, 'silver', e);
  ctx.save();
  roundRect(ctx, 0, 0, W, H, W * 0.05); ctx.clip();
  ctx.fillStyle = linGrad(ctx, 0, H * 0.32, 0, H, [[0, 'rgba(0,0,0,0)'], [1, alpha(e.base, 0.6)]]);
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.strokeStyle = alpha('#ffffff', 0.8);
  ctx.lineWidth = W * 0.004;
  roundRect(ctx, W * 0.012, H * 0.008, W - W * 0.024, H - H * 0.016, W * 0.042); ctx.stroke();

  const m = W * 0.048;
  const ix = m + W * 0.020, iw = W - ix * 2;

  /* ---- header */
  const nameY = m + H * 0.052;
  ctx.fillStyle = '#1a1d24';
  const shownName = meta.personal?.provided ? meta.personal.name : frame.baseName;
  const used = fitText(ctx, shownName, ix, nameY, iw * 0.46, W * 0.062, 800, t.fontDisplay);
  ctx.save();
  ctx.font = font(800, used, t.fontDisplay);
  const nw = ctx.measureText(shownName).width;
  // MAX wordmark
  const mx = ix + nw + W * 0.018, mw = W * 0.115, mh = H * 0.036;
  ctx.fillStyle = linGrad(ctx, mx, nameY - mh, mx + mw, nameY, [[0, e.base], [1, e.dark]]);
  notchRect(ctx, mx, nameY - mh * 0.86, mw, mh, mh * 0.3); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = font(900, mh * 0.56, t.fontDisplay);
  ctx.fillText('MAX', mx + mw / 2, nameY - mh * 0.30);
  ctx.restore();

  hpBlock(ctx, frame, ix + iw, nameY, W, { ...t, plateText: '#1a1d24' }, 1.25);

  ctx.save();
  ctx.fillStyle = 'rgba(26,29,36,.55)';
  ctx.font = font(700, W * 0.020, t.fontBody);
  ctx.fillText(frame.evolvesFrom ? `MAX · evolves from ${frame.evolvesFrom}` : 'MAX Pal', ix, nameY + H * 0.020);
  ctx.restore();

  /* ---- art window, with a burst behind it */
  const awY = nameY + H * 0.030, awH = H * 0.375;
  ctx.save();
  roundRect(ctx, ix, awY, iw, awH, W * 0.016); ctx.clip();
  ctx.fillStyle = e.dark; ctx.fillRect(ix, awY, iw, awH);
  // radiating spokes — the "big card" cue
  ctx.translate(ix + iw / 2, awY + awH / 2);
  for (let i = 0; i < 24; i++) {
    ctx.rotate(TAU / 24);
    ctx.fillStyle = i % 2 ? alpha(e.light, 0.16) : 'rgba(0,0,0,0)';
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.lineTo(iw, -iw * 0.1); ctx.lineTo(iw, iw * 0.1); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  const pad = W * 0.014;
  photoWindow(ctx, photo, ix + pad, awY + pad, iw - pad * 2, awH - pad * 2, W * 0.010, meta.focal);
  drawCharacter(ctx, frame, character, ix + pad, awY + pad, iw - pad * 2, awH - pad * 2, W);
  if (meta.rarity) artBoxHolo(ctx, ix + pad, awY + pad, iw - pad * 2, awH - pad * 2, meta.rarity, meta.seed || 1);
  inset(ctx, ix + pad, awY + pad, iw - pad * 2, awH - pad * 2, W * 0.010, 0.85);
  ctx.save();
  ctx.strokeStyle = linGrad(ctx, ix, awY, ix + iw, awY + awH,
    [[0, '#fdfefe'], [0.4, '#98a1b0'], [0.7, '#eaeff6'], [1, '#7d8492']]);
  ctx.lineWidth = W * 0.009;
  roundRect(ctx, ix, awY, iw, awH, W * 0.016); ctx.stroke();
  ctx.restore();

  /* ---- body */
  const dark = { ...t, textboxText: '#12151b' };
  let by = awY + awH + H * 0.028;
  const footerY = H - m - H * 0.098;

  const bandTop = by;
  const bandBottom = footerY - (c.maxRule ? H * 0.046 : H * 0.012);
  const blockH = measureBody(ctx, c, iw, W, H, dark, { scale: 1.08, maxAttacks: 2 });
  by = bandTop + Math.max(0, (bandBottom - bandTop - blockH) * 0.32);

  by = abilityBox(ctx, c.ability, ix, by, iw, W, H, dark);
  (c.attacks || []).slice(0, 2).forEach((atk, i) => {
    if (by > bandBottom - H * 0.032) return;
    if (i) {
      ctx.save();
      ctx.strokeStyle = 'rgba(20,23,30,.18)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ix + W * 0.02, by - H * 0.007); ctx.lineTo(ix + iw - W * 0.02, by - H * 0.007);
      ctx.stroke(); ctx.restore();
      by += H * 0.007;
    }
    by = attackRow(ctx, atk, ix, by, iw, W, H, dark, { scale: 1.08 });
  });

  /* ---- MAX rule */
  if (c.maxRule) {
    ctx.save();
    ctx.fillStyle = alpha('#7a1020', 0.9);
    ctx.font = `italic ${font(700, W * 0.024, t.fontBody)}`;
    paragraph(ctx, c.maxRule, ix, footerY - H * 0.036, iw, W * 0.024, W * 0.030, 700, t.fontBody, 2);
    ctx.restore();
  }

  typeFooter(ctx, c.footer, ix, footerY, iw, W, H, dark);
  collectorRow(ctx, W, H, frame, meta, 'rgba(20,23,30,.9)', t.fontBody, H - m - H * 0.026);
  fineprint(ctx, W, H, frame, meta, H - m * 0.34, '#141720', t.fontBody);
}

/* ===================================================== CREATURE FULL ART */

export function creatureFullArt(ctx, o) {
  const { W, H, frame, photo, meta, character } = o;
  const t = frame.theme, c = frame.content;
  const e = energy(t.type);
  const secret = frame.variant === 'rainbow';

  /* Photo runs edge to edge — the whole point of a full art. */
  cardBase(ctx, W, H, '#0b0d13');
  clipped(ctx, cc => roundRect(cc, 0, 0, W, H, W * 0.05), cc => {
    if (photo) drawCover(cc, photo, 0, 0, W, H, { x: 0.5, y: 0.24 });
    else { cc.fillStyle = e.dark; cc.fillRect(0, 0, W, H); }
    // type wash + top/bottom scrims so text stays readable over any photo
    cc.fillStyle = radGrad(cc, W * 0.5, H * 0.3, W * 0.15, W * 1.1,
      [[0, alpha(e.light, 0.20)], [1, alpha(e.dark, 0.62)]]);
    cc.fillRect(0, 0, W, H);
    cc.fillStyle = linGrad(cc, 0, 0, 0, H * 0.24, [[0, 'rgba(6,8,12,.82)'], [1, 'rgba(6,8,12,0)']]);
    cc.fillRect(0, 0, W, H * 0.24);
    cc.fillStyle = linGrad(cc, 0, H * 0.42, 0, H, [[0, 'rgba(6,8,12,0)'], [0.42, 'rgba(6,8,12,.72)'], [1, 'rgba(6,8,12,.94)']]);
    cc.fillRect(0, H * 0.42, W, H * 0.58);
  });

  const m = W * 0.030;
  drawCharacter(ctx, frame, character, m, H * 0.10, W - m * 2, H * 0.52, W);

  // metallic edge
  ctx.save();
  ctx.strokeStyle = secret
    ? linGrad(ctx, 0, 0, W, H, [[0, '#8ad9ff'], [0.3, '#d7a4ff'], [0.55, '#ffd0e6'], [0.8, '#ffe9a8'], [1, '#9bf0d0']])
    : alpha(e.light, 0.9);
  ctx.lineWidth = W * 0.012;
  roundRect(ctx, m * 0.7, m * 0.5, W - m * 1.4, H - m, W * 0.042);
  ctx.stroke();
  ctx.restore();

  const ix = W * 0.078, iw = W - ix * 2;

  /* ---- header over the scrim */
  const badgeY = H * 0.040;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.font = font(800, H * 0.016, t.fontBody);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(
    (frame.promo ? 'PROMO' : secret ? 'SECRET RARE' : 'FULL ART') +
    (frame.evolvesFrom ? `  ·  evolves from ${frame.evolvesFrom}` : ''),
    ix, badgeY + H * 0.012);
  ctx.restore();

  const nameY = badgeY + H * 0.060;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = W * 0.03;
  ctx.fillStyle = '#ffffff';
  fitText(ctx, meta.personal?.provided ? meta.personal.name : frame.name,
    ix, nameY, iw * 0.56, W * 0.062, 800, t.fontDisplay);
  ctx.restore();
  hpBlock(ctx, frame, ix + iw, nameY, W, { ...t, plateText: '#ffffff' });

  /* ---- text panel floating over the lower half */
  const panelY = H * 0.552;
  const panelH = H - panelY - H * 0.058;
  ctx.save();
  roundRect(ctx, ix - W * 0.022, panelY, iw + W * 0.044, panelH, W * 0.026);
  ctx.fillStyle = 'rgba(10,13,19,.52)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.lineWidth = W * 0.003;
  ctx.stroke();
  ctx.restore();

  const footerY = panelY + panelH - H * 0.040;
  const bandTop = panelY + H * 0.020;
  const blockH = measureBody(ctx, c, iw, W, H, t, { maxAttacks: 2 });
  let by = bandTop + Math.max(0, (footerY - H * 0.014 - bandTop - blockH) * 0.30);

  by = abilityBox(ctx, c.ability, ix, by, iw, W, H, t, true);
  (c.attacks || []).slice(0, 2).forEach((atk, i) => {
    if (by > footerY - H * 0.030) return;
    if (i) by += H * 0.006;
    by = attackRow(ctx, atk, ix, by, iw, W, H, t, { onDark: true });
  });

  typeFooter(ctx, c.footer, ix, footerY, iw, W, H, t, true);
  collectorRow(ctx, W, H, frame, meta, 'rgba(255,255,255,.92)', t.fontBody, H - H * 0.034);
  fineprint(ctx, W, H, frame, meta, H - H * 0.016, '#ffffff', t.fontBody);

  // Rainbow secrets get a prismatic film over everything but the photo's face.
  if (secret) {
    ctx.save();
    roundRect(ctx, 0, 0, W, H, W * 0.05); ctx.clip();
    ctx.globalCompositeOperation = 'screen';
    const g = ctx.createLinearGradient(0, H, W, 0);
    [[0, 'rgba(120,220,255,.16)'], [0.25, 'rgba(200,140,255,.16)'],
     [0.5, 'rgba(255,150,200,.14)'], [0.75, 'rgba(255,225,140,.16)'],
     [1, 'rgba(140,255,215,.15)']].forEach(([s, col]) => g.addColorStop(s, col));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}



/* =============================================================== KAWAII */

/**
 * The soft/cute card. Pastel stock, scalloped sticker edge, a big rounded photo
 * window with a white outline, a mascot peeking from behind it, and a ribbon
 * nameplate — the visual language of cute character goods.
 *
 * It takes personalisation like the party template, so the same style serves a
 * plain keepsake card and a birthday card.
 */
export function kawaii(ctx, o) {
  const { W, H, frame, photo, meta, companion } = o;
  const t = frame.theme, c = frame.content;
  const e = energy(t.type);
  const p = meta.personal || {};
  const soft = shade(e.light, 0.30);

  /* ---- pastel ground */
  cardBase(ctx, W, H, soft);
  ctx.save();
  roundRect(ctx, 0, 0, W, H, W * 0.075); ctx.clip();
  ctx.fillStyle = linGrad(ctx, 0, 0, W * 0.45, H,
    [[0, shade(e.light, 0.38)], [0.55, soft], [1, shade(e.light, 0.14)]]);
  ctx.fillRect(0, 0, W, H);
  confetti(ctx, 0, 0, W, H,
    [shade(e.base, 0.30), '#ffffff', shade(e.light, 0.20), '#fff0b8'],
    38, (meta.seed || 3) >>> 0, ['star', 'heart', 'dot']);
  ctx.restore();

  /* ---- scalloped sticker edge */
  ctx.save();
  const bm = W * 0.030;
  scallopRect(ctx, bm, bm, W - bm * 2, H - bm * 2, 11);
  ctx.strokeStyle = shade(e.base, 0.10);
  ctx.lineWidth = W * 0.020;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.92)';
  ctx.lineWidth = W * 0.008;
  ctx.stroke();
  ctx.restore();

  const ix = W * 0.098, iw = W - ix * 2;

  /* ---- name + a heart-shaped HP tag */
  const nameY = H * 0.100;
  ctx.fillStyle = e.ink;
  fitText(ctx, p.provided ? p.name : frame.name, ix, nameY, iw * 0.62, W * 0.062, 800, t.fontDisplay);

  const hr = W * 0.050, hx = ix + iw - hr * 0.85, hy = nameY - hr * 0.40;
  withShadow(ctx, alpha(e.dark, 0.32), W * 0.022, 0, W * 0.006, cc => {
    heartPath(cc, hx, hy, hr);
    cc.fillStyle = shade(e.base, -0.02);
    cc.fill();
  });
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.95)';
  ctx.lineWidth = W * 0.006;
  heartPath(ctx, hx, hy, hr);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = font(900, hr * 0.58, t.fontDisplay);
  ctx.fillText(String(p.hp ?? frame.hp), hx, hy + hr * 0.14);
  ctx.restore();

  /* ---- photo, in a thick white sticker outline */
  const awX = ix, awY = H * 0.136;
  const awW = iw, awH = awW * 1.06;
  const lip = W * 0.020;
  withShadow(ctx, alpha(e.dark, 0.30), W * 0.045, 0, W * 0.012, cc => {
    cc.fillStyle = '#ffffff';
    roundRect(cc, awX - lip, awY - lip, awW + lip * 2, awH + lip * 2, W * 0.060);
    cc.fill();
  });
  photoWindow(ctx, photo, awX, awY, awW, awH, W * 0.046, meta.focal);
  meta.artWindow = { x: awX, y: awY, w: awW, h: awH, r: W * 0.046 };
  ctx.save();
  ctx.strokeStyle = alpha(e.base, 0.35);
  ctx.lineWidth = W * 0.005;
  roundRect(ctx, awX, awY, awW, awH, W * 0.046); ctx.stroke();
  ctx.restore();

  /* ---- mascot peeking out from behind the photo */
  if (companion) {
    const cs = W * 0.30;
    const ch = cs * ((companion.height / companion.width) || 1);
    withShadow(ctx, 'rgba(0,0,0,.22)', W * 0.028, 0, W * 0.008, cc => {
      cc.drawImage(companion, awX + awW - cs * 0.86, awY + awH - ch * 0.62, cs, ch);
    });
  }

  /* ---- ribbon nameplate over the photo's lower edge */
  const rbW = iw * 0.80, rbH = H * 0.052;
  const rbX = (W - rbW) / 2, rbY = awY + awH - rbH * 0.42;
  drawRibbon(ctx, rbX, rbY, rbW, rbH, W, e);
  drawBow(ctx, rbX + rbH * 0.30, rbY + rbH * 0.5, rbH * 0.40, shade(e.base, 0.02));
  ctx.save();
  ctx.fillStyle = e.ink;
  ctx.textAlign = 'center';
  // The card's own caption is the default; the customer's headline wins only
  // once they have actually typed a name.
  fitText(ctx, p.provided ? p.headline : (c.caption || frame.name),
    W / 2 + rbH * 0.28, rbY + rbH * 0.66, rbW * 0.72, rbH * 0.50, 800, t.fontDisplay, 'center');
  ctx.restore();

  /* ---- stat chips */
  const chips = c.chips || [];
  const chY = rbY + rbH + H * 0.030;
  const chH = H * 0.050, gap = W * 0.018;
  const chW = (iw - gap * (chips.length - 1)) / Math.max(1, chips.length);
  chips.forEach(([k, v], i) => {
    const x = ix + i * (chW + gap);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    roundRect(ctx, x, chY, chW, chH, chH / 2); ctx.fill();
    ctx.strokeStyle = alpha(e.base, 0.45);
    ctx.lineWidth = W * 0.004; ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = alpha(e.ink, 0.60);
    ctx.font = font(700, chH * 0.25, t.fontBody);
    ctx.fillText(String(k).toUpperCase(), x + chW / 2, chY + chH * 0.38);
    ctx.fillStyle = shade(e.dark, 0.10);
    fitText(ctx, String(v), x + chW / 2, chY + chH * 0.80, chW * 0.84, chH * 0.40, 800, t.fontDisplay, 'center');
    ctx.restore();
  });

  /* ---- caption */
  const capY = chY + chH + H * 0.046;
  const capText = p.provided ? p.thanks : c.caption;
  if (capText) {
    ctx.save();
    ctx.fillStyle = alpha(e.ink, 0.74);
    ctx.textAlign = 'center';
    fitText(ctx, capText, W / 2, capY, iw * 0.94, W * 0.031, 600, t.fontBody, 'center');
    ctx.restore();
  }

  collectorRow(ctx, W, H, frame, meta, alpha(e.ink, 0.66), t.fontBody, H - H * 0.052);
  fineprint(ctx, W, H, frame, meta, H - H * 0.020, e.ink, t.fontBody);
}

function drawBow(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = r * 0.16;
  ctx.fillStyle = color;
  [-1, 1].forEach(d => {
    ctx.beginPath();
    ctx.ellipse(cx + d * r * 0.62, cy, r * 0.60, r * 0.44, d * 0.42, 0, TAU);
    ctx.fill(); ctx.stroke();
  });
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.24, 0, TAU);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawRibbon(ctx, x, y, w, h, W, e) {
  ctx.save();
  const tail = W * 0.048;
  [[x, -1], [x + w, 1]].forEach(([tx, dir]) => {
    ctx.beginPath();
    ctx.moveTo(tx, y + h * 0.16);
    ctx.lineTo(tx + dir * tail, y);
    ctx.lineTo(tx + dir * tail, y + h);
    ctx.lineTo(tx, y + h * 0.84);
    ctx.closePath();
    ctx.fillStyle = shade(e.base, -0.10);
    ctx.fill();
  });
  withShadow(ctx, alpha(e.dark, 0.28), W * 0.022, 0, W * 0.006, cc => {
    cc.fillStyle = shade(e.light, 0.30);
    roundRect(cc, x, y, w, h, h / 2); cc.fill();
  });
  ctx.strokeStyle = 'rgba(255,255,255,.95)';
  ctx.lineWidth = W * 0.006;
  roundRect(ctx, x, y, w, h, h / 2); ctx.stroke();
  ctx.restore();
}

function drawCloud(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  [[-0.72, 0.12, 0.46], [0, -0.14, 0.62], [0.74, 0.14, 0.44]].forEach(([dx, dy, rr]) => {
    ctx.beginPath(); ctx.arc(cx + dx * r, cy + dy * r, rr * r, 0, TAU); ctx.fill();
  });
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.26, r * 1.10, r * 0.34, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/* ================================================================ PARTY */

/**
 * The personalised party card — the format people actually want at a birthday:
 * the kid's name, their age as the headline, made-up attacks about them, a
 * mascot in the corner badge, and a thank-you line for the guests.
 *
 * Everything variable comes in through `meta.personal`, so the same template
 * serves a 6th birthday, a graduation and a baby shower.
 */
export function party(ctx, o) {
  const { W, H, frame, photo, meta, companion } = o;
  const t = frame.theme, c = frame.content;
  const e = energy(t.type);
  const p = meta.personal || {};

  /* ---- festive stock: a saturated party border, not a metallic one */
  cardBase(ctx, W, H, e.base);
  ctx.save();
  roundRect(ctx, 0, 0, W, H, W * 0.05); ctx.clip();
  ctx.fillStyle = linGrad(ctx, 0, 0, W * 0.5, H, [
    [0, shade(e.light, 0.16)], [0.35, e.base], [0.7, shade(e.base, -0.08)], [1, shade(e.light, 0.02)],
  ]);
  ctx.fillRect(0, 0, W, H);
  confettiBand(ctx, 0, 0, W, H, e, meta.seed || 5);
  grain(ctx, 0, 0, W, H, 0.035, 11);
  ctx.restore();

  /* ---- card face */
  const m = W * 0.055;
  ctx.save();
  roundRect(ctx, m * 0.74, m * 0.74, W - m * 1.48, H - m * 1.48, W * 0.024);
  ctx.strokeStyle = alpha(e.ink, 0.45);
  ctx.lineWidth = W * 0.005;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  roundRect(ctx, m, m, W - m * 2, H - m * 2, W * 0.020);
  ctx.clip();
  ctx.fillStyle = '#fffdf7';
  ctx.fillRect(m, m, W - m * 2, H - m * 2);
  ctx.fillStyle = linGrad(ctx, 0, m, 0, H * 0.55, [[0, alpha(e.light, 0.34)], [1, alpha(e.light, 0.03)]]);
  ctx.fillRect(m, m, W - m * 2, H - m * 2);
  ctx.restore();

  const ix = m + W * 0.022, iw = W - ix * 2;

  /* ---- top band: age + companion, with the badge overlapping it */
  const bandH = H * 0.030;
  const bandY = m + H * 0.012;
  const badgeR = W * 0.082;
  const badgeCx = ix + badgeR * 0.72, badgeCy = bandY + badgeR * 0.62;

  ctx.save();
  ctx.fillStyle = alpha(e.dark, 0.14);
  roundRect(ctx, ix + badgeR * 1.5, bandY, iw - badgeR * 1.5, bandH, bandH * 0.3);
  ctx.fill();
  ctx.fillStyle = e.ink;
  ctx.font = font(800, bandH * 0.64, t.fontBody);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(p.ageLabel || `AGE ${p.age ?? '?'}`, ix + badgeR * 1.5 + W * 0.024, bandY + bandH * 0.54);
  if (p.companionName) {
    ctx.textAlign = 'right';
    ctx.font = font(600, bandH * 0.58, t.fontBody);
    ctx.fillStyle = alpha(e.ink, 0.75);
    ctx.fillText(`best friends with ${p.companionName}`, ix + iw - W * 0.022, bandY + bandH * 0.54);
  }
  ctx.restore();

  companionBadge(ctx, companion, badgeCx, badgeCy, badgeR, e.base);

  /* ---- name + HP, clear of the badge that overlaps the band above */
  const nameY = bandY + bandH + H * 0.052;
  const nameX = ix + badgeR * 1.95;
  ctx.fillStyle = e.ink;
  fitText(ctx, p.name || frame.name, nameX, nameY, iw - (nameX - ix) - W * 0.22, W * 0.070, 800, t.fontDisplay);
  hpBlock(ctx, { ...frame, hp: p.hp ?? frame.hp }, ix + iw, nameY, W, { ...t, plateText: e.ink });

  /* ---- photo */
  const awY = nameY + H * 0.014, awH = H * 0.362;
  const win = artWell(ctx, ix, awY, iw, awH, W, t, 'gold');
  meta.artWindow = { ...win };
  photoWindow(ctx, photo, win.x, win.y, win.w, win.h, win.r, meta.focal);
  if (meta.rarity === 'ultra' || meta.rarity === 'secret') {
    artBoxHolo(ctx, win.x, win.y, win.w, win.h, meta.rarity, meta.seed || 1);
  }
  inset(ctx, win.x, win.y, win.w, win.h, win.r, 0.8);

  /* ---- stats ribbon with an edition marker, the way a real card carries
          species / height / weight under the art */
  const ribY = awY + awH + H * 0.014, ribH = H * 0.028;
  ctx.save();
  const edW = ribH * 1.5;
  ctx.fillStyle = e.ink;
  roundRect(ctx, ix, ribY, edW, ribH, ribH * 0.22); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = font(800, ribH * 0.30, t.fontBody);
  ctx.fillText('EDITION', ix + edW / 2, ribY + ribH * 0.32);
  ctx.font = font(900, ribH * 0.46, t.fontDisplay);
  ctx.fillText('1', ix + edW / 2, ribY + ribH * 0.70);

  ctx.fillStyle = alpha(e.base, 0.22);
  roundRect(ctx, ix + edW + W * 0.010, ribY, iw - edW - W * 0.010, ribH, ribH * 0.22); ctx.fill();
  ctx.fillStyle = alpha(e.ink, 0.9);
  ctx.textAlign = 'left';
  ctx.font = `italic ${font(700, ribH * 0.48, t.fontBody)}`;
  ctx.fillText(p.ribbon || 'Party Guest', ix + edW + W * 0.030, ribY + ribH * 0.54);
  ctx.restore();

  /* ---- the headline: the whole reason this format exists */
  const headY = ribY + ribH + H * 0.038;
  ctx.save();
  ctx.fillStyle = e.ink;
  ctx.textAlign = 'center';
  fitText(ctx, p.headline || `${p.name || 'You'} is ${p.age ?? '?'}!`,
    W / 2, headY, iw * 0.94, W * 0.052, 800, t.fontDisplay, 'center');
  ctx.restore();

  /* ---- attacks, centred in the space between headline and footer */
  const footerY = H - m - H * 0.128;
  const bandTop = headY + H * 0.024;
  const atks = (c.attacks || []).slice(0, 2);
  const blockH = measureBody(ctx, { ability: null, attacks: atks }, iw, W, H, t, { maxAttacks: 2 });
  let by = bandTop + Math.max(0, (footerY - H * 0.02 - bandTop - blockH) * 0.42);
  atks.forEach((atk, i) => {
    if (by > footerY - H * 0.05) return;
    if (i) {
      ctx.save();
      ctx.strokeStyle = alpha(e.ink, 0.20); ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ix + W * 0.02, by - H * 0.008); ctx.lineTo(ix + iw - W * 0.02, by - H * 0.008);
      ctx.stroke(); ctx.restore();
      by += H * 0.008;
    }
    by = attackRow(ctx, atk, ix, by, iw, W, H, { ...t, textboxText: e.ink });
  });

  /* ---- weakness / resistance / retreat */
  typeFooter(ctx, c.footer, ix, footerY, iw, W, H, { ...t, textboxText: e.ink, border: e.base });

  /* ---- thank-you banner */
  const thY = footerY + H * 0.042, thH = H * 0.040;
  ctx.save();
  ctx.fillStyle = alpha(e.light, 0.5);
  roundRect(ctx, ix, thY, iw, thH, W * 0.008); ctx.fill();
  ctx.strokeStyle = alpha(e.ink, 0.45);
  ctx.lineWidth = W * 0.003;
  roundRect(ctx, ix, thY, iw, thH, W * 0.008); ctx.stroke();
  ctx.fillStyle = e.ink;
  ctx.textAlign = 'center';
  fitText(ctx, p.thanks || 'Thank you for celebrating with us!',
    W / 2, thY + thH * 0.66, iw * 0.92, W * 0.032, 700, t.fontBody, 'center');
  ctx.restore();

  /* ---- footer */
  ctx.save();
  ctx.fillStyle = alpha(e.ink, 0.62);
  ctx.font = font(600, W * 0.020, t.fontBody);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const fy = H - m - H * 0.010;
  ctx.fillText(`Illus. ${frame.artist || meta.boothName}`, ix, fy);
  ctx.textAlign = 'center';
  ctx.fillText(meta.boothName, W / 2, fy);
  ctx.textAlign = 'right';
  ctx.fillText(`${frame.collectorNumber || ''}`, ix + iw, fy);
  ctx.restore();
  fineprint(ctx, W, H, frame, meta, H - m * 0.30, e.ink, t.fontBody);
}

/** Balloons-and-streamers texture for the party border. */
function confettiBand(ctx, x, y, w, h, e, seed) {
  let s = (seed >>> 0) || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const colors = [shade(e.light, 0.30), '#ffffff', shade(e.base, 0.22), shade(e.light, 0.12)];
  ctx.save();
  for (let i = 0; i < 90; i++) {
    const cx = x + rnd() * w, cy = y + rnd() * h;
    const sz = (0.004 + rnd() * 0.012) * Math.max(w, h);
    ctx.globalAlpha = 0.18 + rnd() * 0.42;
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    const kind = Math.floor(rnd() * 3);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rnd() * TAU);
    if (kind === 0) ctx.fillRect(-sz * 0.5, -sz * 1.4, sz, sz * 2.8);   // streamer
    else if (kind === 1) { ctx.beginPath(); ctx.arc(0, 0, sz * 0.8, 0, TAU); ctx.fill(); }
    else { starPath(ctx, 0, 0, sz * 1.3, sz * 0.55, 5); ctx.fill(); }
    ctx.restore();
  }
  ctx.restore();
}

/* =========================================================== ASSET PACK */

/**
 * Cards built from artwork somebody else supplied under licence. All the work
 * happens in assetpack.mjs; this is the adapter that lets a licensed pack sit
 * in the picker beside the drawn frames and print through the same path.
 */
export function assetPack(ctx, o) {
  const { W, H, frame, photo, meta } = o;
  const loaded = frame.assetPack;
  if (!loaded) throw new Error(`Frame ${frame.id} has no asset pack attached`);

  const p = meta.personal || {};
  return drawAssetCard(ctx, {
    W, H,
    pack: loaded.manifest,
    frame: frame.assetFrame,
    images: loaded.images,
    photo,
    approval: !!meta.approvalMode,
    values: {
      name: p.name || frame.name,
      age: p.age ?? '',
      hp: p.hp ?? frame.hp,
      companion: p.companionName || '',
      headline: p.headline || '',
      thanks: p.thanks || '',
      serial: meta.serial,
      collectorNumber: frame.collectorNumber,
      rarity: meta.rarityLabel,
      booth: meta.boothName,
      date: meta.dateLabel,
      year: new Date(meta.mintedAt || Date.now()).getFullYear(),
      ...(frame.assetFrame.values || {}),
      ...(meta.packValues || {}),
    },
  });
}

/* ================================================================ STRIP */

/**
 * The classic photo strip, as a first-class style rather than a by-product.
 *
 * Aspect is 2:6, not the card's 2.5:3.5, so anything that renders a frame has
 * to read `frame.aspect` rather than assuming a card. It carries the same
 * things a card does — a name the customer chose, a theme, stickers — because
 * plenty of people want the strip and not the trading card.
 */
export function strip(ctx, o) {
  const { W, H, frame, photos = [], photo, meta } = o;
  const t = frame.theme, c = frame.content || {};
  const e = energy(t.type);
  const p = meta.personal || {};
  const dark = c.dark !== false;

  const shots = photos.length ? photos : (photo ? [photo] : []);
  const n = Math.max(1, c.cells || shots.length || 4);

  /* ---- stock */
  const ground = dark ? shade(e.ink, 0.02) : shade(e.light, 0.34);
  ctx.save();
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = linGrad(ctx, 0, 0, W * 0.6, H, dark
    ? [[0, shade(e.dark, -0.10)], [0.55, shade(e.ink, 0.06)], [1, shade(e.dark, -0.14)]]
    : [[0, shade(e.light, 0.40)], [0.55, ground], [1, shade(e.light, 0.18)]]);
  ctx.fillRect(0, 0, W, H);
  if (c.confetti) confetti(ctx, 0, 0, W, H, [shade(e.base, 0.25), '#ffffff', shade(e.light, 0.15)], 30, meta.seed || 4);
  grain(ctx, 0, 0, W, H, 0.03, 17);
  ctx.restore();

  const ink = dark ? '#ffffff' : e.ink;
  const pad = W * 0.070;
  const headerH = c.name === false ? 0 : H * 0.052;
  const footerH = H * 0.098;
  const gap = W * 0.040;
  const cellW = W - pad * 2;
  const cellH = (H - pad * 1.4 - headerH - footerH - gap * (n - 1)) / n;

  /* ---- header: the name they typed */
  if (headerH) {
    ctx.save();
    ctx.fillStyle = alpha(ink, 0.95);
    ctx.textAlign = 'center';
    fitText(ctx, p.provided ? p.name : (c.header || frame.name),
      W / 2, pad * 0.55 + headerH * 0.62, cellW * 0.92, headerH * 0.62, 800, t.fontDisplay, 'center');
    ctx.restore();
  }

  /* ---- the photo column. One window for the whole run, so a sticker can
          straddle two frames the way it does on a real strip. */
  const colY = pad * 0.7 + headerH;
  const colH = n * cellH + (n - 1) * gap;
  meta.artWindow = { x: pad, y: colY, w: cellW, h: colH, r: W * 0.012 };

  for (let i = 0; i < n; i++) {
    const y = colY + i * (cellH + gap);
    ctx.save();
    ctx.fillStyle = '#000';
    roundRect(ctx, pad, y, cellW, cellH, W * 0.012); ctx.fill();
    ctx.restore();
    photoWindow(ctx, shots[i % Math.max(1, shots.length)] || null, pad, y, cellW, cellH, W * 0.012, meta.focal);
    ctx.save();
    ctx.strokeStyle = alpha(dark ? e.light : e.base, 0.45);
    ctx.lineWidth = W * 0.006;
    roundRect(ctx, pad, y, cellW, cellH, W * 0.012); ctx.stroke();
    ctx.restore();
  }

  /* ---- footer */
  const fy = H - footerH;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = alpha(ink, 0.96);
  fitText(ctx, meta.boothName || 'HOLOBOOTH', W / 2, fy + footerH * 0.40, cellW * 0.86, W * 0.082, 800, t.fontDisplay, 'center');
  ctx.fillStyle = alpha(ink, 0.62);
  fitText(ctx, `${meta.dateLabel}  ·  ${meta.serial}`,
    W / 2, fy + footerH * 0.72, cellW * 0.92, W * 0.036, 600, t.fontBody, 'center');
  ctx.restore();
}

export const TEMPLATES = { creature, creatureMax, creatureFullArt, party, kawaii, assetPack, strip };
