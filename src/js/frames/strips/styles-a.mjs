/**
 * styles-a.mjs — concepts A–F of the HoloBooth Strip Collection.
 *
 * Each style is { id, name, letter, blurb, defaultHeadline, palettes, draw }.
 * draw(env) paints the whole sheet; see engine.mjs for what env carries.
 * Rules every style follows:
 *   - photos are the hero: nothing is drawn over a photo except, where the
 *     concept demands it, one small corner element (a date stamp, a corner
 *     of tape) that never reaches a face
 *   - printed type is >= 6pt, and >= 0.1in from the trim
 *   - the HoloBooth spark/wordmark appears once, small, in the design's ink
 */

import { grid } from './engine.mjs';
import {
  FONTS, text, measure, vtext, wrap, photo, paper, filmGrain, lin, rad, heart, star, sparkle,
  tape, segDigits, brand, rule, frameRect, shadowed, logo, hexA, roundRect, rng, TAU, sprig,
} from './kit.mjs';

/* ================================================================ A LUXE */

export const luxe = {
  id: 'luxe', letter: 'A', name: 'Atelier',
  blurb: 'Minimalist luxury. Gallery margins, a hairline border, a Didone name.',
  defaultHeadline: 'Holobooth',
  palettes: {
    ivory: { name: 'Ivory', bg: '#f3eee5', ink: '#1c1a17', line: '#b6a27c', sub: '#7a6f5f' },
    noir: { name: 'Noir', bg: '#101010', ink: '#efe9de', line: '#a88f5c', sub: '#958c7e', tone: 'mono' },
    sand: { name: 'Sand', bg: '#e3d6c1', ink: '#3a2e24', line: '#8c7356', sub: '#6d5a48' },
    pearl: { name: 'Pearl', bg: '#fbfaf7', ink: '#262626', line: '#cfc8bb', sub: '#8a857c', tone: 'soft' },
  },
  draw(e) {
    const { ctx, W, H, u, pt, pal, T, jumbo } = e;
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);
    paper(ctx, 0, 0, W, H, 41, { fibres: 0.03, tooth: 0.02, dark: pal.bg < '#5' });

    // double hairline border
    const b1 = u(jumbo ? 0.14 : 0.075);
    frameRect(ctx, b1, b1, W - b1 * 2, H - b1 * 2, pal.line, pt(0.6));
    frameRect(ctx, b1 + u(0.03), b1 + u(0.03), W - (b1 + u(0.03)) * 2, H - (b1 + u(0.03)) * 2, hexA(pal.line, 0.55), pt(0.35));

    const m = u(jumbo ? 0.34 : 0.17);
    const footer = u(jumbo ? (T.logo ? 2.2 : 1.85) : 1.08);
    const gap = u(jumbo ? 0.12 : 0.075);
    const slots = e.arrange({ x: m, y: m, w: W - m * 2, h: H - m - footer - u(0.02) }, gap);
    slots.forEach(s => {
      e.track(s);
      photo(ctx, e.img(s.i), s, { tone: e.tone, focal: e.focal });
      frameRect(ctx, s.x - u(0.012), s.y - u(0.012), s.w + u(0.024), s.h + u(0.024), hexA(pal.line, 0.7), pt(0.4));
    });

    // footer — a fixed vertical rhythm, top to bottom, brand last
    const fy = H - footer;
    const cx = W / 2;
    let y = fy + u(jumbo ? 0.2 : 0.12);
    if (T.logo && jumbo) { logo(ctx, T.logo, cx - u(0.6), y, u(1.2), u(0.34)); y += u(0.4); }
    y += pt(jumbo ? 30 : 18);
    text(ctx, T.headline, cx, y, {
      size: pt(jumbo ? 34 : 21), font: FONTS.didot, style: 'italic', weight: 400, color: pal.ink, align: 'center', maxW: W - m * 2.4,
    });
    y += u(jumbo ? 0.2 : 0.14);
    rule(ctx, cx - u(jumbo ? 0.3 : 0.2), y, cx + u(jumbo ? 0.3 : 0.2), y, pal.line, pt(0.6));
    y += u(jumbo ? 0.22 : 0.17);
    text(ctx, T.date.long, cx, y, { size: pt(jumbo ? 8 : 6.5), font: FONTS.avenir, weight: 500, tracking: 0.28, upper: true, color: pal.sub, align: 'center', maxW: W - m * 2 });
    // the message is a Jumbo feature: a 2x6 footer has no room for it
    if (T.message && jumbo) {
      y += u(0.22);
      text(ctx, T.message, cx, y, { size: pt(9.5), font: FONTS.serif, style: 'italic', color: pal.sub, align: 'center', maxW: W - m * 2.2 });
    }
    brand(ctx, cx, H - b1 - u(jumbo ? 0.17 : 0.12), pt(jumbo ? 6.5 : 6), pal.ink, { tracking: 0.42, weight: 500 });
  },
};

/* ================================================================ B REEL */

export const reel = {
  id: 'reel', letter: 'B', name: 'Reel',
  blurb: 'Retro film. Sprockets, edge print, a glowing date stamp and grain.',
  defaultHeadline: 'Holobooth 400',
  palettes: {
    gold: { name: 'Gold Stock', film: '#16110d', edge: '#f0a53a', label: '#f5b91c', label2: '#d3261d', labelInk: '#1b1208', hole: '#f4ecdc', tone: 'warm' },
    cine: { name: 'Cine Amber', film: '#2b170d', edge: '#f2b46a', label: '#efe2c4', label2: '#7a2a12', labelInk: '#2b170d', hole: '#f3e6cf', tone: 'faded' },
    slide: { name: 'Slide Blue', film: '#0c0f13', edge: '#d6dde6', label: '#2f63b5', label2: '#f2f2f2', labelInk: '#ffffff', hole: '#eef1f5', tone: 'cool' },
    mono: { name: 'Pan B&W', film: '#0b0b0b', edge: '#e8e8e8', label: '#e9e7e1', label2: '#111111', labelInk: '#111111', hole: '#f2f2f2', tone: 'silver' },
  },
  draw(e) {
    const { ctx, W, H, u, pt, pal, T, jumbo, n } = e;
    // the "paper" outside the film is the print stock
    ctx.fillStyle = pal.hole; ctx.fillRect(0, 0, W, H);
    const filmX = u(jumbo ? 0.42 : 0.05), filmW = W - filmX * 2;
    ctx.fillStyle = pal.film; ctx.fillRect(filmX, 0, filmW, H);

    // sprocket holes, both sides
    const hw = u(jumbo ? 0.12 : 0.078), hh = u(jumbo ? 0.16 : 0.11), pitch = u(jumbo ? 0.26 : 0.187);
    const laneIn = u(jumbo ? 0.12 : 0.085);
    for (const side of [0, 1]) {
      const hx = side ? filmX + filmW - laneIn - hw : filmX + laneIn;
      for (let y = -pitch * 0.3; y < H; y += pitch) {
        ctx.fillStyle = pal.hole; roundRect(ctx, hx, y, hw, hh, hw * 0.22); ctx.fill();
      }
    }
    // edge print in the outer lanes
    const laneX = [filmX + laneIn * 0.5, filmX + filmW - laneIn * 0.5];
    const ep = pt(jumbo ? 7 : 5.2);
    for (let k = 0, y = u(0.5); y < H - u(0.3); y += u(jumbo ? 1.5 : 1.15), k++) {
      vtext(ctx, `HOLOBOOTH 400   ${k * 2 + 12}`, laneX[0], y, 1, { size: ep, font: FONTS.din, weight: 600, color: pal.edge, tracking: 0.12 });
      vtext(ctx, `${k + 1}    ${k + 1}A`, laneX[1], y + u(0.4), 1, { size: ep, font: FONTS.din, weight: 600, color: pal.edge, tracking: 0.1 });
    }

    const inner = filmX + laneIn * 2 + hw + u(jumbo ? 0.1 : 0.04);
    const label = u(jumbo ? 1.2 : 0.95);
    const gap = u(jumbo ? 0.16 : 0.1);
    const region = { x: inner, y: u(jumbo ? 0.3 : 0.16), w: W - inner * 2, h: H - label - u(jumbo ? 0.3 : 0.16) - u(0.08) };
    const slots = e.arrange(region, gap, { maxA: 1.6, minA: 1.25 });
    slots.forEach((s, i) => {
      e.track(s);
      photo(ctx, e.img(s.i), s, { r: u(0.018), tone: e.tone, focal: e.focal });
      // frame number under each frame, edge-print style
      text(ctx, String(i + 1).padStart(2, '0'), s.x + s.w, s.y + s.h + pt(jumbo ? 8 : 6) + u(0.01), { size: pt(jumbo ? 6.5 : 5), font: FONTS.din, weight: 600, color: hexA(pal.edge, 0.85), align: 'right' });
    });
    // the date stamp, burned into the last frame's corner like a point-and-shoot
    const last = slots[slots.length - 1];
    segDigits(ctx, T.date.stamp, last.x + last.w - u(jumbo ? 0.1 : 0.07), last.y + last.h - u(jumbo ? 0.1 : 0.07) - pt(jumbo ? 9 : 6.5), pt(jumbo ? 9 : 6.5), '#ff8a2a');

    // light leak at the head of the roll (frame area only, never on faces)
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = rad(ctx, filmX, 0, 0, u(jumbo ? 1.6 : 0.9), [[0, 'rgba(255,120,40,.55)'], [0.5, 'rgba(255,60,20,.18)'], [1, 'rgba(255,60,20,0)']]);
    ctx.fillRect(filmX, 0, filmW, region.y + u(0.06));
    ctx.restore();

    // canister label
    const ly = H - label, lx = inner, lw = W - inner * 2;
    ctx.fillStyle = pal.label; ctx.fillRect(lx, ly + u(0.04), lw, label - u(jumbo ? 0.3 : 0.16));
    ctx.fillStyle = pal.label2; ctx.fillRect(lx, ly + u(0.04), lw, u(jumbo ? 0.1 : 0.07));
    const ink = pal.labelInk;
    const lh = label - u(jumbo ? 0.3 : 0.16);
    const pad = u(jumbo ? 0.12 : 0.07);
    const badgeW = measure(ctx, '400', { size: pt(jumbo ? 22 : 13), font: FONTS.impact });
    text(ctx, T.headline, lx + pad, ly + u(0.04) + lh * 0.52, { size: pt(jumbo ? 24 : 15), font: FONTS.impact, weight: 400, color: ink, maxW: lw - badgeW - pad * 3, upper: true, tracking: 0.02 });
    text(ctx, `${n} EXP · ISO 400 · ${T.date.short}`, lx + u(jumbo ? 0.12 : 0.07), ly + u(0.04) + lh * 0.8, { size: pt(jumbo ? 7.5 : 6), font: FONTS.din, weight: 700, color: hexA(ink, 0.8), tracking: 0.08, maxW: lw * 0.9 });
    // big "400" badge
    const bx = lx + lw - u(jumbo ? 0.12 : 0.07);
    text(ctx, '400', bx, ly + u(0.04) + lh * 0.55, { size: pt(jumbo ? 22 : 13), font: FONTS.impact, color: pal.label2 === '#f2f2f2' ? ink : pal.label2, align: 'right' });
    brand(ctx, lx + lw / 2, H - u(jumbo ? 0.1 : 0.055), pt(jumbo ? 6.5 : 5.5), pal.edge, { font: FONTS.din, tracking: 0.36 });
    filmGrain(ctx, 0, 0, W, H, 0.05, e.seed + 3);
  },
};

/* ================================================================= C Y2K */

export const y2k = {
  id: 'y2k', letter: 'C', name: 'Starlight 2K',
  blurb: 'Y2K pop. Chrome type, candy gradients, sparkles and sticker slaps.',
  defaultHeadline: 'Besties',
  palettes: {
    bubblegum: { name: 'Bubblegum', g: ['#ffcfe9', '#e5c9ff', '#bfe4ff'], ink: '#2a1e5c', tint: '#c7a4ff', accent: '#ff4fa3', accent2: '#5ad1ff', sticker: '#fff36b' },
    ice: { name: 'Ice', g: ['#eef4ff', '#c9dcff', '#f2f0f7'], ink: '#13213d', tint: '#8fb6ff', accent: '#3d7bff', accent2: '#b8c6dd', sticker: '#ffffff' },
    lime: { name: 'Lime Soda', g: ['#efffb8', '#d4fff1', '#f6f6f6'], ink: '#1d2b10', tint: '#b6ff3d', accent: '#6ccf00', accent2: '#ff7ad9', sticker: '#ffffff' },
    cyber: { name: 'Cyber Night', g: ['#1a0d3d', '#3a1260', '#0a2246'], ink: '#ffffff', tint: '#ff7ad9', accent: '#ff4fd1', accent2: '#7af7ff', sticker: '#fff36b', dark: true },
  },
  draw(e) {
    const { ctx, W, H, u, pt, pal, T, jumbo } = e;
    const r = rng(e.seed + 5);
    ctx.fillStyle = lin(ctx, 0, 0, W * 0.4, H, [[0, pal.g[0]], [0.5, pal.g[1]], [1, pal.g[2]]]);
    ctx.fillRect(0, 0, W, H);
    // soft blobs
    for (let i = 0; i < 6; i++) {
      const bx = r() * W, by = r() * H, br = u(jumbo ? 1.1 : 0.7) * (0.6 + r());
      ctx.fillStyle = rad(ctx, bx, by, 0, br, [[0, hexA(i % 2 ? pal.accent2 : pal.accent, pal.dark ? 0.35 : 0.22)], [1, hexA(pal.accent, 0)]]);
      ctx.fillRect(0, 0, W, H);
    }
    // grid floor lines at the bottom, very faint
    ctx.save(); ctx.strokeStyle = hexA(pal.dark ? '#ffffff' : pal.ink, 0.08); ctx.lineWidth = pt(0.5);
    for (let x = 0; x < W; x += u(0.16)) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += u(0.16)) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.restore();

    // chrome headline
    const head = u(jumbo ? 1.05 : 0.72);
    const hs = pt(jumbo ? 46 : 27);
    chromeText(ctx, T.headline, W / 2, head * 0.68, hs, W - u(jumbo ? 0.5 : 0.22), pal, pt);
    text(ctx, 'FOREVER 2K', W / 2, head * 0.68 + pt(jumbo ? 13 : 8.5), { size: pt(jumbo ? 7.5 : 6), font: FONTS.geo, weight: 700, style: 'italic', tracking: 0.35, color: pal.dark ? '#ffffff' : pal.ink, align: 'center', alpha: 0.85 });

    const m = u(jumbo ? 0.3 : 0.15), foot = u(jumbo ? 0.78 : 0.62), gap = u(jumbo ? 0.16 : 0.1);
    const slots = e.arrange({ x: m, y: head + u(0.08), w: W - m * 2, h: H - head - foot - u(0.08) }, gap);
    const rad0 = u(jumbo ? 0.12 : 0.08);
    slots.forEach(s => {
      e.track(s);
      shadowed(ctx, hexA(pal.dark ? '#000000' : pal.accent, 0.35), u(0.08), 0, u(0.03), () => { ctx.fillStyle = '#fff'; roundRect(ctx, s.x, s.y, s.w, s.h, rad0); ctx.fill(); });
      photo(ctx, e.img(s.i), s, { r: rad0, focal: e.focal, tone: e.tone });
      // chrome bezel
      ctx.save();
      ctx.lineWidth = pt(jumbo ? 4 : 3);
      ctx.strokeStyle = lin(ctx, s.x, s.y, s.x, s.y + s.h, [[0, '#ffffff'], [0.45, pal.tint], [0.5, '#4a4f63'], [0.62, '#e9eef6'], [1, '#ffffff']]);
      roundRect(ctx, s.x, s.y, s.w, s.h, rad0); ctx.stroke();
      ctx.lineWidth = pt(0.6); ctx.strokeStyle = hexA(pal.dark ? '#ffffff' : pal.ink, 0.5);
      roundRect(ctx, s.x - pt(1.6), s.y - pt(1.6), s.w + pt(3.2), s.h + pt(3.2), rad0 + pt(1.6)); ctx.stroke();
      ctx.restore();
    });

    // sticker slaps on outer corners (never toward the middle of a frame)
    const sz = u(jumbo ? 0.34 : 0.22);
    const first = slots[0], last = slots[slots.length - 1];
    starSticker(ctx, first.x + first.w - sz * 0.2, first.y + sz * 0.15, sz, pal.sticker, pal.ink, -0.2);
    heartSticker(ctx, last.x + sz * 0.25, last.y + last.h - sz * 0.2, sz * 0.95, pal.accent, 0.25);
    if (slots.length > 2) pillSticker(ctx, slots[1].x + slots[1].w - u(0.05), slots[1].y + slots[1].h - u(0.02), 'XOXO', pt(jumbo ? 9 : 6.5), pal);
    // sparkles in the margins
    const sp = [[0.08, 0.04], [0.92, 0.1], [0.06, 0.55], [0.94, 0.62], [0.1, 0.97], [0.9, 0.9]];
    sp.forEach(([fx, fy], i) => glint(ctx, fx * W, fy * H, u(jumbo ? 0.11 : 0.07) * (i % 2 ? 0.8 : 1.1), pal.dark ? '#ffffff' : '#ffffff', pal.accent));

    // footer
    const fy = H - foot;
    const pillW = u(jumbo ? 1.3 : 0.95), pillH = u(jumbo ? 0.26 : 0.19);
    ctx.fillStyle = pal.dark ? hexA('#ffffff', 0.14) : '#ffffff';
    roundRect(ctx, W / 2 - pillW / 2, fy + u(0.12), pillW, pillH, pillH / 2); ctx.fill();
    ctx.strokeStyle = pal.accent; ctx.lineWidth = pt(1); ctx.stroke();
    text(ctx, T.date.short, W / 2, fy + u(0.12) + pillH * 0.7, { size: pt(jumbo ? 10 : 7.5), font: FONTS.geo, weight: 700, style: 'italic', tracking: 0.12, color: pal.dark ? '#fff' : pal.ink, align: 'center' });
    brand(ctx, W / 2, H - u(jumbo ? 0.16 : 0.12), pt(jumbo ? 7 : 6), pal.dark ? '#ffffff' : pal.ink, { font: FONTS.geo, weight: 700, tracking: 0.3 });
  },
};

function chromeText(ctx, str, x, y, size, maxW, pal, pt) {
  const o = { size, font: FONTS.geo, weight: 800, style: 'italic', align: 'center', maxW, upper: true, tracking: 0.02 };
  const s = text(ctx, str, x, y, { ...o, color: 'transparent', alpha: 0 }).size;
  const top = y - s * 0.78;
  // drop shadow / outline
  text(ctx, str, x + pt(1.2), y + pt(1.6), { ...o, size: s, minSize: s, color: hexA(pal.accent, 0.9), stroke: hexA(pal.accent, 0.9), strokeW: pt(3) });
  text(ctx, str, x, y, { ...o, size: s, minSize: s, color: '#fff', stroke: pal.dark ? '#120a2a' : pal.ink, strokeW: pt(2.6) });
  ctx.save();
  const g = lin(ctx, 0, top, 0, y + s * 0.05, [[0, '#ffffff'], [0.38, '#e4ecf7'], [0.5, pal.tint], [0.53, '#3b3f55'], [0.68, '#8f9ab3'], [1, '#ffffff']]);
  text(ctx, str, x, y, { ...o, size: s, minSize: s, color: g });
  ctx.restore();
}

function glint(ctx, x, y, r, c, glow) {
  ctx.save();
  ctx.shadowColor = glow; ctx.shadowBlur = r * 1.2;
  sparkle(ctx, x, y, r, 0.12); ctx.fillStyle = c; ctx.fill();
  ctx.restore();
}
function starSticker(ctx, x, y, s, fill, ink, rot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  star(ctx, 0, 0, s * 0.55, s * 0.26, 5); ctx.lineJoin = 'round';
  ctx.lineWidth = s * 0.16; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = s * 0.04; ctx.strokeStyle = ink; ctx.stroke();
  ctx.restore();
}
function heartSticker(ctx, x, y, s, fill, rot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  heart(ctx, 0, 0, s); ctx.lineJoin = 'round';
  ctx.lineWidth = s * 0.16; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  ctx.fillStyle = fill; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(-s * 0.18, -s * 0.12, s * 0.08, s * 0.05, -0.6, 0, TAU); ctx.fill();
  ctx.restore();
}
function pillSticker(ctx, x, y, str, size, pal) {
  const w = measure(ctx, str, { size, font: FONTS.geo, weight: 800, tracking: 0.1 }) + size * 1.4, h = size * 1.6;
  ctx.save(); ctx.translate(x, y); ctx.rotate(-0.12);
  ctx.fillStyle = '#ffffff'; roundRect(ctx, -w / 2 - size * 0.18, -h / 2 - size * 0.18, w + size * 0.36, h + size * 0.36, h); ctx.fill();
  ctx.fillStyle = pal.accent2; roundRect(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fill();
  text(ctx, str, 0, size * 0.36, { size, font: FONTS.geo, weight: 800, style: 'italic', color: pal.dark ? '#120a2a' : pal.ink, align: 'center', tracking: 0.1 });
  ctx.restore();
}

/* =============================================================== D SEOUL */

export const seoul = {
  id: 'seoul', letter: 'D', name: 'Seoul Cut',
  blurb: 'Korean photo-booth. Clean white, pastel doodles, a four-cut layout.',
  defaultHeadline: 'today’s us',
  palettes: {
    milk: { name: 'Milk', bg: '#ffffff', ink: '#3b3b3b', a: '#ffb3c7', b: '#bfe0ff', c: '#ffe58f' },
    peach: { name: 'Peach', bg: '#ffeadf', ink: '#6b4a3a', a: '#ff9c7a', b: '#fff1b0', c: '#ffffff' },
    sky: { name: 'Sky', bg: '#e2f0ff', ink: '#35557a', a: '#8fc3ff', b: '#ffffff', c: '#ffd1e0' },
    lilac: { name: 'Lilac', bg: '#efe8ff', ink: '#574a86', a: '#c3b1ff', b: '#ffd6ec', c: '#ffffff' },
    matcha: { name: 'Matcha', bg: '#eef4e3', ink: '#4c5e3a', a: '#b6d396', b: '#fff6c9', c: '#ffffff' },
  },
  draw(e) {
    const { ctx, W, H, u, pt, pal, T, jumbo } = e;
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);
    // a whisper of dot texture
    ctx.save(); ctx.fillStyle = hexA(pal.ink, 0.04);
    for (let y = u(0.06); y < H; y += u(0.12)) for (let x = u(0.06) + ((y / u(0.12)) % 2) * u(0.06); x < W; x += u(0.12)) { ctx.beginPath(); ctx.arc(x, y, u(0.008), 0, TAU); ctx.fill(); }
    ctx.restore();

    const m = u(jumbo ? 0.26 : 0.13);
    const head = u(jumbo ? 0.62 : 0.34), foot = u(jumbo ? 1.05 : 0.95);
    const gap = u(jumbo ? 0.12 : 0.07);
    // header: tiny centred lockup, the way Seoul booths sign their frames
    text(ctx, 'photo by', W / 2 - u(jumbo ? 0.42 : 0.3), head * 0.62, { size: pt(jumbo ? 8 : 6), font: FONTS.hand, color: pal.ink, align: 'right', alpha: 0.75 });
    brand(ctx, W / 2 - u(jumbo ? 0.38 : 0.27), head * 0.62, pt(jumbo ? 8 : 6), pal.ink, { align: 'left', font: FONTS.round, weight: 700, tracking: 0.12 });
    const slots = e.arrange({ x: m, y: head, w: W - m * 2, h: H - head - foot }, gap, { minA: jumbo ? 0.8 : 1.25 });
    slots.forEach(s => {
      e.track(s);
      photo(ctx, e.img(s.i), s, { r: u(jumbo ? 0.06 : 0.035), focal: e.focal, tone: e.tone || 'soft' });
    });

    // doodles in the gutters only
    const r = rng(e.seed + 9);
    const doodle = (x, y, s, k) => {
      ctx.save(); ctx.lineWidth = s * 0.14; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (k === 0) { heart(ctx, x, y, s); ctx.fillStyle = pal.a; ctx.fill(); }
      else if (k === 1) { star(ctx, x, y, s * 0.5, s * 0.25, 5); ctx.strokeStyle = pal.a; ctx.stroke(); }
      else if (k === 2) { sparkle(ctx, x, y, s * 0.45); ctx.fillStyle = shade2(pal); ctx.fill(); }
      else { ctx.fillStyle = pal.b === '#ffffff' ? pal.a : pal.b; cloud(ctx, x, y, s * 0.55); ctx.fill(); ctx.strokeStyle = hexA(pal.ink, 0.25); ctx.lineWidth = s * 0.06; ctx.stroke(); }
      ctx.restore();
    };
    const ds = u(jumbo ? 0.17 : 0.12);
    doodle(m + ds * 0.4, head * 0.45, ds, 0);
    doodle(W - m - ds * 0.4, head * 0.5, ds, 2);

    // footer: Korean + English lines, handwritten heart, date
    const fy = H - foot;
    const line1 = T.name || T.event ? (T.name || T.event) : '오늘의 우리';
    const big = text(ctx, line1, W / 2, fy + u(jumbo ? 0.42 : 0.33), { size: pt(jumbo ? 19 : 13), font: T.name || T.event ? FONTS.round : FONTS.korean, weight: 700, color: pal.ink, align: 'center', maxW: W - m * 3 });
    heart(ctx, W / 2 + big.width / 2 + u(0.08), fy + u(jumbo ? 0.36 : 0.28), u(jumbo ? 0.13 : 0.09)); ctx.fillStyle = pal.a; ctx.fill();
    text(ctx, T.name || T.event ? '오늘의 우리 · today’s us' : 'today’s us', W / 2, fy + u(jumbo ? 0.62 : 0.5), { size: pt(jumbo ? 9 : 6.8), font: T.name || T.event ? FONTS.korean : FONTS.hand, color: hexA(pal.ink, 0.8), align: 'center', maxW: W - m * 2 });
    text(ctx, T.date.iso, W / 2, fy + u(jumbo ? 0.84 : 0.7), { size: pt(jumbo ? 7.5 : 6), font: FONTS.round, weight: 600, tracking: 0.18, color: hexA(pal.ink, 0.65), align: 'center' });
    for (let i = 0; i < 4; i++) doodle(m + r() * u(0.25), fy + u(0.2) + r() * (foot - u(0.4)), ds * 0.75, i % 4);
    for (let i = 0; i < 4; i++) doodle(W - m - r() * u(0.25), fy + u(0.2) + r() * (foot - u(0.4)), ds * 0.75, (i + 2) % 4);
  },
};
function shade2(pal) { return pal.c === '#ffffff' ? pal.a : pal.c; }
function cloud(ctx, x, y, s) {
  ctx.beginPath();
  ctx.arc(x - s * 0.45, y + s * 0.1, s * 0.38, Math.PI * 0.5, Math.PI * 1.5);
  ctx.arc(x - s * 0.05, y - s * 0.2, s * 0.48, Math.PI, TAU);
  ctx.arc(x + s * 0.48, y + s * 0.08, s * 0.36, Math.PI * 1.5, Math.PI * 0.5);
  ctx.closePath();
}

/* ============================================================ E EDITORIAL */

const SHORTLINES = ['MAIN CHARACTER', 'UNFILTERED', 'EXCLUSIVE', 'STYLE NOTES', 'BACKSTAGE'];
const COVERLINES = ['THE MAIN CHARACTER ISSUE', 'CANDID & UNFILTERED', 'EXCLUSIVE: THE AFTER PARTY', 'STYLE NOTES', 'BEHIND THE CURTAIN'];

export const editorial = {
  id: 'editorial', letter: 'E', name: 'Cover Story',
  blurb: 'Editorial magazine. A masthead with your name, cover lines, asymmetry.',
  defaultHeadline: 'BOOTH',
  palettes: {
    mono: { name: 'Mono', bg: '#f7f6f2', ink: '#111111', accent: '#111111', sub: '#5a5a5a', tone: 'mono' },
    press: { name: 'Press Red', bg: '#efebe2', ink: '#141414', accent: '#d4261c', sub: '#55524c', tone: 'mono' },
    ink: { name: 'Ink', bg: '#121212', ink: '#f3f1ec', accent: '#e8e2d4', sub: '#a29e95', tone: 'silver' },
    nude: { name: 'Nude', bg: '#e9ddcf', ink: '#2b2420', accent: '#8a5a3c', sub: '#6a5b50' },
  },
  draw(e) {
    const { ctx, W, H, u, pt, pal, T, jumbo, n } = e;
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);
    const m = u(jumbo ? 0.24 : 0.12);
    // masthead
    const mastH = u(jumbo ? 1.02 : 0.62);
    const mast = String(T.headline).toUpperCase();
    text(ctx, mast, W / 2, mastH - u(jumbo ? 0.2 : 0.12), { size: pt(jumbo ? 64 : 40), font: FONTS.didot, weight: 700, color: pal.ink, align: 'center', maxW: W - m * 2, minSize: pt(14), tracking: -0.01 });
    rule(ctx, m, mastH, W - m, mastH, pal.ink, pt(0.8));
    const issue = jumbo
      ? `Nº ${String(T.date.m).padStart(2, '0')} — ${T.date.issue.toUpperCase()} — HOLOBOOTH EDITION`
      : `Nº ${String(T.date.m).padStart(2, '0')} · ${T.date.issue.slice(0, 3).toUpperCase()} ${T.date.y} · HOLOBOOTH`;
    text(ctx, issue, W / 2, mastH + pt(jumbo ? 9 : 6.5) + u(0.02), { size: pt(jumbo ? 7 : 6), font: FONTS.avenir, weight: 600, tracking: jumbo ? 0.2 : 0.1, color: pal.sub, align: 'center', maxW: W - m * 2 });
    const top = mastH + u(jumbo ? 0.26 : 0.18);
    const foot = u(jumbo ? 0.5 : 0.52);
    const gap = u(jumbo ? 0.14 : 0.09);
    const region = { x: m, y: top, w: W - m * 2, h: H - top - foot };

    let slots;
    if (!jumbo) {
      // asymmetric strip: first frame full width, then alternating 72% frames
      // with a vertical cover line in the leftover column
      const narrow = region.w * 0.74;
      const hFull = region.w / 1.3;
      const hRest = (region.h - hFull - gap * (n - 1)) / (n - 1);
      slots = [{ x: region.x, y: region.y, w: region.w, h: hFull, i: 0 }];
      for (let i = 1; i < n; i++) {
        const left = i % 2 === 1;
        slots.push({ x: left ? region.x : region.x + region.w - narrow, y: region.y + hFull + gap + (i - 1) * (hRest + gap), w: narrow, h: hRest, i });
      }
    } else {
      const heroH = Math.min(region.w / 1.42, region.h * 0.6);
      const hero = { x: region.x, y: region.y, w: region.w, h: heroH, i: 0 };
      const rest = n - 1;
      // two or four small frames share a column beside the cover lines;
      // three run the full width (and the cover-line column steps aside)
      const fullRow = rest === 3;
      const below = { x: region.x, y: region.y + heroH + gap, w: fullRow ? region.w : region.w * 0.7, h: region.h - heroH - gap };
      const cells = grid(below, rest === 4 ? 2 : rest, rest === 4 ? 2 : 1, { gap, minA: 0.8, maxA: 1.7 });
      // flush left under the hero, like a magazine column, unless it's a full row
      const shift = fullRow ? 0 : Math.min(...cells.map(c => c.x)) - below.x;
      const sub = cells.map((c, k) => ({ ...c, x: c.x - shift, i: k + 1 }));
      e.coverColumn = !fullRow;
      slots = [hero, ...sub];
    }
    slots.forEach(s => { e.track(s); photo(ctx, e.img(s.i), s, { tone: e.tone, focal: e.focal }); });

    // cover lines in the open columns
    if (!jumbo) {
      for (let i = 1; i < n; i++) {
        const s = slots[i];
        const left = i % 2 === 1;
        const cx = left ? s.x + s.w + (region.w - s.w) / 2 : region.x + (region.w - s.w) / 2;
        text(ctx, `${String(i + 1).padStart(2, '0')}`, cx, s.y + pt(13), { size: pt(14), font: FONTS.didot, weight: 700, color: pal.accent, align: 'center' });
        vtext(ctx, SHORTLINES[(i - 1) % SHORTLINES.length], cx, s.y + s.h * 0.6, -1, { size: pt(6), font: FONTS.avenir, weight: 700, tracking: 0.08, color: pal.ink, align: 'center', maxW: s.h * 0.72 });
      }
    } else if (e.coverColumn) {
      const colX = region.x + region.w * 0.7 + gap, colW = region.w * 0.3 - gap;
      let y = slots[0].y + slots[0].h + gap + pt(14);
      text(ctx, 'INSIDE', colX, y, { size: pt(9), font: FONTS.avenir, weight: 800, tracking: 0.3, color: pal.accent });
      y += u(0.12);
      rule(ctx, colX, y, colX + colW, y, pal.ink, pt(0.6));
      const floor = H - foot - (T.logo ? u(0.7) : u(0.1)) - (T.message ? u(0.62) : 0);
      COVERLINES.slice(0, 4).forEach((c, k) => {
        if (y + u(0.53) > floor) return;
        y += u(0.26);
        text(ctx, String(k + 2).padStart(2, '0'), colX, y, { size: pt(14), font: FONTS.didot, weight: 700, color: pal.accent });
        y += u(0.16);
        const words = c.split(' ');
        const half = Math.ceil(words.length / 2);
        text(ctx, words.slice(0, half).join(' '), colX, y, { size: pt(7.5), font: FONTS.avenir, weight: 700, tracking: 0.08, color: pal.ink, maxW: colW });
        y += u(0.12);
        text(ctx, words.slice(half).join(' '), colX, y, { size: pt(7.5), font: FONTS.avenir, weight: 700, tracking: 0.08, color: pal.ink, maxW: colW });
      });
      if (T.message) { y += u(0.3); wrap(ctx, `“${T.message}”`, colX, y, colW, pt(10.5), { size: pt(8.5), font: FONTS.serif, style: 'italic', color: pal.sub }, 4); }
      if (T.logo) logo(ctx, T.logo, colX, H - foot - u(0.62), colW, u(0.5), 'left');
    }
    // footer: barcode + date + mark
    const fy = H - foot;
    barcode(ctx, m, fy + u(jumbo ? 0.12 : 0.13), u(jumbo ? 0.8 : 0.52), u(jumbo ? 0.26 : 0.22), pal.ink, e.seed);
    text(ctx, T.date.dots, W - m, fy + u(jumbo ? 0.24 : 0.24), { size: pt(jumbo ? 8 : 6.5), font: FONTS.avenir, weight: 700, tracking: 0.12, color: pal.ink, align: 'right' });
    brand(ctx, W - m, fy + u(jumbo ? 0.38 : 0.36), pt(jumbo ? 6.5 : 5.5), pal.sub, { align: 'right', variant: 'word', tracking: 0.3 });
  },
};

function barcode(ctx, x, y, w, h, color, seed) {
  const r = rng(seed + 77);
  ctx.save(); ctx.fillStyle = color;
  let xx = x;
  while (xx < x + w) { const bw = (r() < 0.6 ? 1 : r() < 0.7 ? 2 : 3) * w * 0.012; if (r() < 0.62) ctx.fillRect(xx, y, bw, h); xx += bw + w * 0.01; }
  ctx.restore();
}

/* ============================================================ F INSTANT */

const CAPTIONS = ['best night', 'us', 'lol', 'again!', 'forever'];

export const instant = {
  id: 'instant', letter: 'F', name: 'Instant',
  blurb: 'Instant-film frames, handwritten captions and a little tape.',
  defaultHeadline: 'good times',
  palettes: {
    kraft: { name: 'Kraft', bg: '#c8a67b', frame: '#fbfaf6', pen: '#2b2b2b', ink: '#2e2418', tape: 'rgba(250,240,205,.72)' },
    linen: { name: 'Linen', bg: '#ebe5da', frame: '#ffffff', pen: '#24365e', ink: '#2c3e66', tape: 'rgba(205,225,240,.75)' },
    blush: { name: 'Blush', bg: '#f1d3d3', frame: '#fffdfb', pen: '#8a2f45', ink: '#8a2f45', tape: 'rgba(255,255,255,.6)' },
    sage: { name: 'Sage', bg: '#cdd7c2', frame: '#fbfbf6', pen: '#2f3e2a', ink: '#2f3e2a', tape: 'rgba(250,236,190,.7)' },
    night: { name: 'Night', bg: '#1f2331', frame: '#f6f4ef', pen: '#262626', ink: '#f1ede4', tape: 'rgba(255,230,160,.55)' },
  },
  draw(e) {
    const { ctx, W, H, u, pt, pal, T, jumbo, n } = e;
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);
    paper(ctx, 0, 0, W, H, 23, { fibres: 0.08, tooth: 0.04, dark: pal.bg < '#5' });
    const r = rng(e.seed + 31);
    const head = u(jumbo ? 0.78 : 0.12), foot = u(jumbo ? 0.55 : 0.66);
    const m = u(jumbo ? 0.16 : 0.13);
    const region = { x: m, y: head, w: W - m * 2, h: H - head - foot };

    // instant frame: square-ish window, fat bottom lip
    const lip = 0.24, side = 0.06; // as a fraction of frame width
    let frames;
    if (!jumbo) {
      const fh = (region.h - u(0.06) * (n - 1)) / n;
      frames = Array.from({ length: n }, (_, i) => ({ w: Math.min(region.w * 0.94, fh * 0.86), h: fh, cx: W / 2 + (i % 2 ? 1 : -1) * u(0.04), cy: region.y + fh / 2 + i * (fh + u(0.06)), rot: [-0.045, 0.035, -0.025, 0.04, -0.03][i % 5] }));
    } else {
      const cols = n === 3 ? 1 : 2, rows = Math.ceil(n / cols);
      const cg = u(0.1);
      const cw = (region.w - cg * (cols - 1)) / cols, ch = (region.h - u(0.12) * (rows - 1)) / rows;
      frames = Array.from({ length: n }, (_, i) => {
        const c = i % cols, rr = Math.floor(i / cols);
        const lastOdd = n % 2 === 1 && i === n - 1 && cols === 2;
        const fw = Math.min(cw, ch * 0.86), fh = fw / 0.86;
        return { w: n === 3 ? Math.min(region.w * 0.66, ch * 1.15) : fw, h: n === 3 ? ch : fh, cx: lastOdd ? W / 2 : region.x + c * (cw + cg) + cw / 2, cy: region.y + rr * (ch + u(0.12)) + ch / 2, rot: [-0.05, 0.04, 0.03, -0.035, 0.02][i % 5] };
      });
    }
    frames.forEach((f, i) => {
      const fw = f.w, fh = f.h;
      const inset = fw * side;
      const pw = fw - inset * 2, ph = fh - inset - fw * lip;
      ctx.save();
      ctx.translate(f.cx, f.cy); ctx.rotate(f.rot);
      shadowed(ctx, 'rgba(0,0,0,.28)', u(0.06), u(0.01), u(0.025), () => { ctx.fillStyle = pal.frame; ctx.fillRect(-fw / 2, -fh / 2, fw, fh); });
      const s = { x: -fw / 2 + inset, y: -fh / 2 + inset, w: pw, h: ph, i };
      photo(ctx, e.img(i), s, { focal: e.focal, tone: e.tone, inner: 'rgba(0,0,0,.25)' });
      const cap = i === 0 && T.name ? T.name : i === n - 1 ? T.date.short : CAPTIONS[i % CAPTIONS.length];
      const cy = fh / 2 - fw * lip * 0.42;
      const cw2 = text(ctx, cap, 0, cy, { size: pt(jumbo ? 15 : 10), font: FONTS.hand, color: pal.pen, align: 'center', maxW: pw * 0.8 }).width;
      if (cap === 'us') { heart(ctx, cw2 / 2 + pt(7), cy - pt(4), pt(8)); ctx.fillStyle = '#d64a5f'; ctx.fill(); }
      ctx.restore();
      // world-space slot for stickers (unrotated bounds of the window)
      e.track({ x: f.cx - pw / 2, y: f.cy - fh / 2 + inset, w: pw, h: ph });
      if (i % 2 === 0 || jumbo) tape(ctx, f.cx + (i % 2 ? fw * 0.3 : -fw * 0.3), f.cy - fh / 2 + u(0.01), u(jumbo ? 0.62 : 0.42), u(jumbo ? 0.17 : 0.12), (i % 2 ? 0.5 : -0.55) + (r() - 0.5) * 0.2, pal.tape, i + 3);
    });

    if (jumbo) {
      text(ctx, T.headline, W / 2, head * 0.66, { size: pt(30), font: FONTS.hand, color: pal.ink, align: 'center', maxW: W - m * 2.5 });
    }
    const fy = H - foot;
    if (!jumbo) text(ctx, T.headline, W / 2, fy + u(0.3), { size: pt(16), font: FONTS.hand, color: pal.ink, align: 'center', maxW: W - m * 2 });
    else text(ctx, T.message || T.date.long, W / 2, fy + u(0.3), { size: pt(11), font: FONTS.hand, color: hexA(pal.ink, 0.85), align: 'center', maxW: W - m * 2 });
    brand(ctx, W / 2, H - u(jumbo ? 0.14 : 0.12), pt(jumbo ? 6.5 : 6), hexA(pal.ink, 0.8), { tracking: 0.34, font: FONTS.type, weight: 400 });
  },
};

export { sprig };
