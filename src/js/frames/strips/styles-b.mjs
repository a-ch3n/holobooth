/**
 * styles-b.mjs — concepts G–L of the HoloBooth Strip Collection.
 * Same contract and rules as styles-a.mjs.
 */

import {
  FONTS, text, measure, vtext, photo, paper, lin, rad, heart, star, sparkle, sprig,
  tape, tornRect, doodleArrow, brand, rule, frameRect, shadowed, logo, hexA, roundRect,
  rng, TAU, brushedMetal, holoStops, halftone, slotPath,
} from './kit.mjs';

/* ============================================================== G CHROME */

export const chrome = {
  id: 'chrome', letter: 'G', name: 'Chrome Drive',
  blurb: 'Futuristic chrome. Brushed metal, bevelled frames, a holographic band.',
  defaultHeadline: 'Holobooth',
  palettes: {
    silver: { name: 'Liquid Silver', bg: ['#30353e', '#121418', '#262a31'], tint: '#9fb4d8', ink: '#e8edf5', sub: '#8d97a8', holo: 0.75 },
    holo: { name: 'Holo Black', bg: ['#141418', '#050507', '#111116'], tint: '#d9a8ff', ink: '#f4f4f8', sub: '#9a96a8', holo: 1 },
    ice: { name: 'Ice', bg: ['#e9eef5', '#b9c5d4', '#dfe6ef'], tint: '#7aa2e0', ink: '#0f1724', sub: '#4b586b', holo: 0.6, light: true },
    gold: { name: 'Gold Leaf', bg: ['#2a2520', '#0e0c0a', '#221e19'], tint: '#e0b45c', ink: '#f3e7cf', sub: '#a8977a', holo: 0.35, warm: true },
  },
  draw(e) {
    const { ctx, W, H, u, pt, pal, T, jumbo, n } = e;
    brushedMetal(ctx, 0, 0, W, H, [[0, pal.bg[0]], [0.5, pal.bg[1]], [1, pal.bg[2]]], e.seed);
    const metal = (y0, y1) => lin(ctx, 0, y0, 0, y1, pal.warm
      ? [[0, '#fff6dc'], [0.4, '#e9c77d'], [0.5, '#6b5226'], [0.62, '#c9a35a'], [1, '#fff3d0']]
      : [[0, '#ffffff'], [0.42, '#dfe6f0'], [0.5, '#3a404c'], [0.6, pal.tint], [1, '#ffffff']]);

    // holographic band + chrome wordmark
    const band = u(jumbo ? 0.86 : 0.6);
    ctx.save();
    ctx.globalAlpha = pal.holo;
    ctx.fillStyle = lin(ctx, 0, 0, W, band, holoStops(0.85)); ctx.fillRect(0, u(jumbo ? 0.16 : 0.1), W, band - u(jumbo ? 0.2 : 0.12));
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(0, u(jumbo ? 0.16 : 0.1), W, pt(0.6));
    const hs = pt(jumbo ? 30 : 17);
    const hy = band * 0.66;
    text(ctx, T.headline, W / 2, hy, { size: hs, font: FONTS.geo, weight: 700, tracking: 0.22, upper: true, color: '#0b0d12', align: 'center', maxW: W - u(0.3), stroke: '#0b0d12', strokeW: pt(2.2) });
    text(ctx, T.headline, W / 2, hy, { size: hs, font: FONTS.geo, weight: 700, tracking: 0.22, upper: true, color: metal(hy - hs * 0.8, hy), align: 'center', maxW: W - u(0.3) });

    const m = u(jumbo ? 0.4 : 0.2), foot = u(jumbo ? 0.62 : 0.5), gap = u(jumbo ? 0.2 : 0.13);
    const slots = e.arrange({ x: m, y: band + u(0.1), w: W - m * 2, h: H - band - foot - u(0.1) }, gap);
    const bev = pt(jumbo ? 4 : 3);
    slots.forEach((s, i) => {
      e.track(s);
      // bevelled chrome bezel
      ctx.fillStyle = metal(s.y - bev, s.y + s.h + bev);
      roundRect(ctx, s.x - bev, s.y - bev, s.w + bev * 2, s.h + bev * 2, u(0.03)); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = pt(0.5); ctx.stroke();
      photo(ctx, e.img(s.i), s, { r: u(0.012), tone: e.tone, focal: e.focal });
      // HUD corner brackets just outside the bezel
      const L = u(jumbo ? 0.14 : 0.09), o = bev + u(0.035);
      ctx.save(); ctx.strokeStyle = hexA(pal.ink, 0.75); ctx.lineWidth = pt(0.8);
      [[s.x - o, s.y - o, 1, 1], [s.x + s.w + o, s.y - o, -1, 1], [s.x - o, s.y + s.h + o, 1, -1], [s.x + s.w + o, s.y + s.h + o, -1, -1]].forEach(([x, y, sx, sy]) => {
        ctx.beginPath(); ctx.moveTo(x + sx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * L); ctx.stroke();
      });
      ctx.restore();
      // frame counter in the side margin
      if (m > u(0.15)) vtext(ctx, `CAP ${String(i + 1).padStart(2, '0')}/${String(n).padStart(2, '0')}`, s.x - bev - u(jumbo ? 0.17 : 0.1), s.y + s.h / 2, -1, { size: pt(jumbo ? 6.5 : 5), font: FONTS.mono, color: pal.sub, align: 'center', tracking: 0.12 });
    });

    // footer telemetry line + mark
    const fy = H - foot;
    rule(ctx, m, fy + u(0.12), W - m, fy + u(0.12), hexA(pal.ink, 0.35), pt(0.5));
    text(ctx, `HB—SYS  ${T.date.iso}${T.serial && jumbo ? '  //  ' + T.serial : ''}`, W / 2, fy + u(jumbo ? 0.3 : 0.27), { size: pt(jumbo ? 7 : 5.5), font: FONTS.mono, color: pal.sub, align: 'center', tracking: 0.1, maxW: W - m * 2 });
    brand(ctx, W / 2, H - u(jumbo ? 0.12 : 0.09), pt(jumbo ? 7 : 5.8), pal.ink, { font: FONTS.geo, weight: 600, tracking: 0.42 });
    // a holo glint on the bezel of the first frame
    const s0 = slots[0];
    ctx.save(); ctx.shadowColor = '#ffffff'; ctx.shadowBlur = u(0.06);
    sparkle(ctx, s0.x + s0.w + bev * 0.4, s0.y - bev * 0.4, u(jumbo ? 0.1 : 0.07)); ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.restore();
  },
};

/* =========================================================== H SCRAPBOOK */

const NOTES = ['best. night. ever.', 'remember this!!', 'us <3', 'iconic', 'no thoughts, just vibes'];

export const scrapbook = {
  id: 'scrapbook', letter: 'H', name: 'Scrapbook',
  blurb: 'Torn paper, tape, stickers and notes in the margin.',
  defaultHeadline: 'memories',
  palettes: {
    kraft: { name: 'Kraft', bg: '#d8bd95', papers: ['#f7f2e7', '#e9c4be', '#c6d9e7', '#f3e0a2'], ink: '#2a2622', tape: 'rgba(240,226,180,.78)', pop: '#e0483e', pop2: '#f5c33b' },
    gingham: { name: 'Gingham', bg: '#fbe3e8', check: '#f2a7b8', papers: ['#ffffff', '#fff2c6', '#d9ecff', '#e6f6dc'], ink: '#5a2235', tape: 'rgba(255,255,255,.7)', pop: '#ff6f91', pop2: '#ffd34d' },
    notebook: { name: 'Notebook', bg: '#fbfbf7', lines: '#b9d3ee', margin: '#ef8f8f', papers: ['#fff7c9', '#ffd8e2', '#d6f0e0', '#e3e6ff'], ink: '#1f3b73', tape: 'rgba(170,205,240,.7)', pop: '#3a7bd5', pop2: '#ffcc33' },
  },
  draw(e) {
    const { ctx, W, H, u, pt, pal, T, jumbo, n } = e;
    const r = rng(e.seed + 51);
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);
    if (pal.check) {
      const c = u(jumbo ? 0.22 : 0.16);
      ctx.fillStyle = hexA(pal.check, 0.45);
      for (let x = 0; x < W; x += c * 2) ctx.fillRect(x, 0, c, H);
      for (let y = 0; y < H; y += c * 2) ctx.fillRect(0, y, W, c);
    }
    if (pal.lines) {
      ctx.fillStyle = pal.lines;
      for (let y = u(0.3); y < H; y += u(0.2)) ctx.fillRect(0, y, W, pt(0.5));
      ctx.fillStyle = pal.margin; ctx.fillRect(u(jumbo ? 0.28 : 0.12), 0, pt(0.7), H);
    }
    paper(ctx, 0, 0, W, H, 61, { fibres: 0.06, tooth: 0.035 });

    const head = u(jumbo ? 0.95 : 0.62), foot = u(jumbo ? 0.62 : 0.55);
    const m = u(jumbo ? 0.34 : 0.2), gap = u(jumbo ? 0.22 : 0.15);
    // header: name on a torn label, taped down
    const lw = W - u(jumbo ? 1.2 : 0.4), lh = u(jumbo ? 0.5 : 0.36), lx = (W - lw) / 2, ly = head * 0.22;
    ctx.save(); ctx.translate(W / 2, ly + lh / 2); ctx.rotate(-0.025); ctx.translate(-W / 2, -(ly + lh / 2));
    shadowed(ctx, 'rgba(0,0,0,.18)', u(0.03), 0, u(0.012), () => { tornRect(ctx, lx, ly, lw, lh, 5, u(0.03), 'lr'); ctx.fillStyle = pal.papers[0]; ctx.fill(); });
    text(ctx, T.headline, W / 2, ly + lh * 0.7, { size: pt(jumbo ? 24 : 15), font: FONTS.marker, color: pal.ink, align: 'center', maxW: lw * 0.86 });
    ctx.restore();
    tape(ctx, lx + u(0.05), ly + u(0.02), u(jumbo ? 0.42 : 0.3), u(jumbo ? 0.12 : 0.09), -0.7, pal.tape, 2);

    const slots = e.arrange({ x: m, y: head, w: W - m * 2, h: H - head - foot }, gap, { maxA: 1.6 });
    slots.forEach((s, i) => {
      e.track(s);
      const rot = (i % 2 ? 1 : -1) * (0.02 + r() * 0.025);
      // torn coloured paper behind
      ctx.save(); ctx.translate(s.x + s.w / 2, s.y + s.h / 2); ctx.rotate(-rot * 1.8); ctx.translate(-(s.x + s.w / 2), -(s.y + s.h / 2));
      tornRect(ctx, s.x - u(0.07), s.y - u(0.06), s.w + u(0.14), s.h + u(0.12), i + 9, u(0.035));
      ctx.fillStyle = pal.papers[(i + 1) % pal.papers.length]; ctx.fill();
      ctx.restore();
      // the photo, white-bordered, slightly turned
      const b = u(0.03);
      ctx.save(); ctx.translate(s.x + s.w / 2, s.y + s.h / 2); ctx.rotate(rot); ctx.translate(-(s.x + s.w / 2), -(s.y + s.h / 2));
      shadowed(ctx, 'rgba(0,0,0,.25)', u(0.04), 0, u(0.015), () => { ctx.fillStyle = '#fff'; ctx.fillRect(s.x - b, s.y - b, s.w + b * 2, s.h + b * 2); });
      photo(ctx, e.img(s.i), s, { focal: e.focal, tone: e.tone });
      ctx.restore();
      // tape on alternating corners
      tape(ctx, i % 2 ? s.x + s.w - u(0.04) : s.x + u(0.04), s.y - u(0.02), u(jumbo ? 0.42 : 0.3), u(jumbo ? 0.12 : 0.085), i % 2 ? 0.6 : -0.6, pal.tape, i + 20);
    });

    // margin life: stickers + one handwritten note with an arrow
    const sz = u(jumbo ? 0.24 : 0.16);
    const L = slots[slots.length - 1], F = slots[0];
    ctx.save(); ctx.translate(F.x + F.w + u(0.02), F.y + F.h - u(0.03)); ctx.rotate(0.2);
    star(ctx, 0, 0, sz * 0.6, sz * 0.28, 5); ctx.lineWidth = sz * 0.14; ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.fillStyle = pal.pop2; ctx.fill();
    ctx.restore();
    ctx.save(); ctx.translate(L.x - u(0.01), L.y + u(0.06)); ctx.rotate(-0.25);
    heart(ctx, 0, 0, sz * 1.1); ctx.lineWidth = sz * 0.14; ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.fillStyle = pal.pop; ctx.fill();
    ctx.restore();
    // flower sticker
    if (n > 2) {
      const S = slots[1];
      const fx = S.x + S.w + u(0.0), fy0 = S.y + S.h * 0.5;
      ctx.save(); ctx.translate(fx, fy0);
      for (let k = 0; k < 6; k++) { ctx.rotate(TAU / 6); ctx.beginPath(); ctx.ellipse(sz * 0.32, 0, sz * 0.28, sz * 0.17, 0, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill(); }
      ctx.beginPath(); ctx.arc(0, 0, sz * 0.17, 0, TAU); ctx.fillStyle = pal.pop2; ctx.fill();
      ctx.restore();
    }
    const fy = H - foot;
    const note = T.message || NOTES[e.seed % NOTES.length];
    const tw = text(ctx, note, W / 2 + u(0.1), fy + u(jumbo ? 0.3 : 0.25), { size: pt(jumbo ? 13 : 9), font: FONTS.hand, color: pal.ink, align: 'center', maxW: W - m * 2.6 }).width;
    doodleArrow(ctx, W / 2 + u(0.1) - tw / 2 - u(0.06), fy + u(jumbo ? 0.24 : 0.2), W / 2 + u(0.1) - tw / 2 - u(jumbo ? 0.42 : 0.24), fy - u(0.02), pal.ink, pt(0.9), false);
    text(ctx, T.date.short, W - m, H - u(jumbo ? 0.14 : 0.1), { size: pt(jumbo ? 8 : 6.5), font: FONTS.hand, color: hexA(pal.ink, 0.8), align: 'right' });
    brand(ctx, m, H - u(jumbo ? 0.14 : 0.1), pt(jumbo ? 6 : 5.2), hexA(pal.ink, 0.75), { align: 'left', font: FONTS.type, weight: 400, tracking: 0.2 });
  },
};

/* ============================================================ I DATE NIGHT */

export const datenight = {
  id: 'datenight', letter: 'I', name: 'Date Night',
  blurb: 'For two. Arched windows, a script name line, hearts kept quiet.',
  defaultHeadline: 'Date Night',
  palettes: {
    rouge: { name: 'Rouge', bg: ['#6a0f1f', '#3d0711'], ink: '#fbe4e7', accent: '#e9a2ad', gold: '#d9b77a' },
    rose: { name: 'Rosé', bg: ['#f8e0e3', '#f0c9cf'], ink: '#7a1f33', accent: '#d96b81', gold: '#b88a5a' },
    midnight: { name: 'Midnight', bg: ['#18203d', '#0b1024'], ink: '#f2e6d0', accent: '#d6b47a', gold: '#d6b47a' },
    blanc: { name: 'Blanc', bg: ['#fffaf8', '#f6ece9'], ink: '#3d1d24', accent: '#e05a76', gold: '#c49a6c' },
  },
  draw(e) {
    const { ctx, W, H, u, pt, pal, T, jumbo } = e;
    ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, pal.bg[0]], [1, pal.bg[1]]]); ctx.fillRect(0, 0, W, H);
    // quiet heart pattern
    ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = pal.ink;
    const step = u(jumbo ? 0.34 : 0.24);
    for (let y = step / 2, k = 0; y < H; y += step, k++) for (let x = (k % 2 ? step / 2 : 0) + step / 4; x < W; x += step) { heart(ctx, x, y, u(0.05)); ctx.fill(); }
    ctx.restore();

    const m = u(jumbo ? 0.38 : 0.17), head = u(jumbo ? 0.42 : 0.2), foot = u(jumbo ? 1.4 : 1.12), gap = u(jumbo ? 0.16 : 0.1);
    const slots = e.arrange({ x: m, y: head, w: W - m * 2, h: H - head - foot }, gap, { minA: 1.05 });
    slots.forEach(s => {
      e.track(s);
      photo(ctx, e.img(s.i), s, { shape: 'arch', focal: { x: e.focal.x, y: 0.38 }, tone: e.tone });
      const o = u(jumbo ? 0.05 : 0.035);
      ctx.save(); ctx.strokeStyle = pal.gold; ctx.lineWidth = pt(0.7);
      slotPath(ctx, { x: s.x - o, y: s.y - o, w: s.w + o * 2, h: s.h + o * 2 }, 'arch'); ctx.stroke();
      ctx.restore();
    });

    const fy = H - foot;
    // heart rule
    const cy = fy + u(jumbo ? 0.26 : 0.2);
    rule(ctx, W / 2 - u(jumbo ? 0.9 : 0.55), cy, W / 2 - u(0.1), cy, pal.gold, pt(0.6));
    rule(ctx, W / 2 + u(0.1), cy, W / 2 + u(jumbo ? 0.9 : 0.55), cy, pal.gold, pt(0.6));
    heart(ctx, W / 2, cy + u(0.005), u(jumbo ? 0.12 : 0.09)); ctx.fillStyle = pal.accent; ctx.fill();
    const names = T.name || T.event || T.headline;
    text(ctx, names, W / 2, cy + u(jumbo ? 0.58 : 0.44), { size: pt(jumbo ? 34 : 22), font: FONTS.script, color: pal.ink, align: 'center', maxW: W - m * 1.6 });
    text(ctx, T.date.spaced, W / 2, cy + u(jumbo ? 0.86 : 0.68), { size: pt(jumbo ? 8.5 : 6.6), font: FONTS.serif, weight: 400, tracking: 0.3, color: pal.ink, align: 'center', alpha: 0.85 });
    if (T.message && jumbo) text(ctx, T.message, W / 2, cy + u(1.06), { size: pt(8), font: FONTS.serif, style: 'italic', color: pal.ink, align: 'center', alpha: 0.75, maxW: W - m * 2 });
    brand(ctx, W / 2, H - u(jumbo ? 0.14 : 0.1), pt(jumbo ? 6.2 : 5.4), hexA(pal.ink, 0.7), { tracking: 0.4, font: FONTS.serif, weight: 400 });
  },
};

/* ============================================================ J BIRTHDAY */

export const birthday = {
  id: 'birthday', letter: 'J', name: 'Party Pop',
  blurb: 'Birthday. Confetti, candy-coloured type, the age in a balloon.',
  defaultHeadline: 'Birthday Star',
  palettes: {
    confetti: { name: 'Confetti', bg: '#fffaf1', ink: '#1d1d3a', pops: ['#ff5a7a', '#ffc23d', '#2fc39b', '#4d8bff', '#a46bff'] },
    sprinkle: { name: 'Sprinkle', bg: '#ffd9e7', ink: '#5e1638', pops: ['#ff4f8b', '#ffffff', '#ffcf3f', '#47c6ff', '#9b6bff'] },
    party: { name: 'Party Night', bg: '#15163a', ink: '#ffffff', pops: ['#ffd25a', '#ff5fa2', '#5ee2ff', '#9e7bff', '#ffffff'], dark: true },
    sunshine: { name: 'Sunshine', bg: '#ffe25e', ink: '#2b2350', pops: ['#ff5a5a', '#ffffff', '#2b2350', '#3fb7ff', '#ff8ad0'] },
  },
  draw(e) {
    const { ctx, W, H, u, pt, pal, T, jumbo } = e;
    const r = rng(e.seed + 71);
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);
    // confetti field (behind everything; frames sit on top)
    for (let i = 0; i < (jumbo ? 120 : 70); i++) {
      const x = r() * W, y = r() * H, s = u(jumbo ? 0.05 : 0.035) * (0.6 + r());
      ctx.save(); ctx.translate(x, y); ctx.rotate(r() * TAU);
      ctx.fillStyle = pal.pops[i % pal.pops.length]; ctx.globalAlpha = 0.85;
      const k = i % 3;
      if (k === 0) ctx.fillRect(-s, -s * 0.35, s * 2, s * 0.7);
      else if (k === 1) { ctx.beginPath(); ctx.arc(0, 0, s * 0.55, 0, TAU); ctx.fill(); }
      else { ctx.lineWidth = s * 0.4; ctx.strokeStyle = ctx.fillStyle; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-s, 0); ctx.quadraticCurveTo(0, -s, s, 0); ctx.stroke(); }
      ctx.restore();
    }

    // header: HAPPY / BIRTHDAY in candy letters
    const head = u(jumbo ? 1.15 : 0.82);
    candy(ctx, 'HAPPY', W / 2, head * 0.42, pt(jumbo ? 30 : 17), W - u(0.6), pal, 0, pt);
    candy(ctx, 'BIRTHDAY', W / 2, head * 0.86, pt(jumbo ? 34 : 19.5), W - u(jumbo ? 0.5 : 0.2), pal, 2, pt);

    const m = u(jumbo ? 0.34 : 0.17), foot = u(jumbo ? 1.05 : 0.98), gap = u(jumbo ? 0.2 : 0.13);
    const slots = e.arrange({ x: m, y: head + u(0.1), w: W - m * 2, h: H - head - foot - u(0.1) }, gap);
    const rr = u(jumbo ? 0.08 : 0.05), bw = u(jumbo ? 0.06 : 0.04);
    slots.forEach((s, i) => {
      e.track(s);
      ctx.fillStyle = pal.pops[i % pal.pops.length];
      roundRect(ctx, s.x - bw + u(0.035), s.y - bw + u(0.035), s.w + bw * 2, s.h + bw * 2, rr + bw); ctx.fill();
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, s.x - bw, s.y - bw, s.w + bw * 2, s.h + bw * 2, rr + bw); ctx.fill();
      photo(ctx, e.img(s.i), s, { r: rr, focal: e.focal, tone: e.tone || 'bright' });
    });

    // footer: name + age balloon
    const fy = H - foot;
    const hasAge = T.age != null && T.age > 0 && T.age < 130;
    const nameLine = T.name || T.event || T.headline;
    const bx = hasAge ? W - m - u(jumbo ? 0.42 : 0.28) : 0;
    text(ctx, nameLine, hasAge ? m : W / 2, fy + u(jumbo ? 0.48 : 0.4), { size: pt(jumbo ? 26 : 16), font: FONTS.black, weight: 900, color: pal.ink, align: hasAge ? 'left' : 'center', maxW: hasAge ? bx - m - u(0.42) : W - m * 2, upper: true });
    text(ctx, T.date.long, hasAge ? m : W / 2, fy + u(jumbo ? 0.72 : 0.6), { size: pt(jumbo ? 8 : 6.5), font: FONTS.avenir, weight: 700, tracking: 0.18, upper: true, color: hexA(pal.ink, 0.75), align: hasAge ? 'left' : 'center', maxW: W - m * 2 });
    if (hasAge) {
      const br = u(jumbo ? 0.36 : 0.25), by = fy + u(jumbo ? 0.42 : 0.36);
      ctx.save();
      ctx.strokeStyle = hexA(pal.ink, 0.6); ctx.lineWidth = pt(0.7);
      ctx.beginPath(); ctx.moveTo(bx, by + br * 1.15); ctx.bezierCurveTo(bx - br * 0.3, by + br * 1.6, bx + br * 0.3, by + br * 1.9, bx, by + br * 2.3); ctx.stroke();
      ctx.fillStyle = pal.pops[0];
      ctx.beginPath(); ctx.ellipse(bx, by, br * 0.9, br * 1.08, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx - br * 0.12, by + br * 1.18); ctx.lineTo(bx + br * 0.12, by + br * 1.18); ctx.lineTo(bx, by + br * 1.04); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.ellipse(bx - br * 0.36, by - br * 0.42, br * 0.14, br * 0.26, 0.5, 0, TAU); ctx.fill();
      text(ctx, String(T.age), bx, by + br * 0.38, { size: br * 1.15, font: FONTS.black, weight: 900, color: '#ffffff', align: 'center', maxW: br * 1.5 });
      ctx.restore();
    }
    brand(ctx, W / 2, H - u(jumbo ? 0.14 : 0.1), pt(jumbo ? 6.5 : 5.6), hexA(pal.ink, 0.75), { font: FONTS.avenir, weight: 700, tracking: 0.34 });
  },
};

/** Per-letter candy colours with a white keyline and a soft drop. */
function candy(ctx, str, x, y, size, maxW, pal, offset, pt) {
  const o = { size, font: FONTS.black, weight: 900, tracking: 0.04 };
  let s = size;
  while (measure(ctx, str, { ...o, size: s }) > maxW && s > size * 0.5) s *= 0.95;
  const total = measure(ctx, str, { ...o, size: s });
  let cx = x - total / 2;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const wch = measure(ctx, ch, { ...o, size: s });
    const col = pal.pops[(i + offset) % pal.pops.length];
    const c = col === '#ffffff' && !pal.dark ? pal.ink : col;
    const bob = (i % 2 ? -1 : 1) * s * 0.03;
    text(ctx, ch, cx + pt(1.2), y + bob + pt(1.5), { ...o, size: s, minSize: s, color: hexA(pal.dark ? '#000000' : pal.ink, 0.35) });
    text(ctx, ch, cx, y + bob, { ...o, size: s, minSize: s, color: c, stroke: pal.dark ? pal.bg : '#ffffff', strokeW: pt(2.2) });
    cx += wch + s * 0.04;
  }
}

/* ============================================================ K KEEPSAKE */

export const keepsake = {
  id: 'keepsake', letter: 'K', name: 'Keepsake',
  blurb: 'Weddings and events. Names in script, a crest or your logo, botanicals.',
  defaultHeadline: 'With Love',
  palettes: {
    botanical: { name: 'Botanical', bg: '#f6f2ea', ink: '#2e3a2c', leaf: '#8a9a78', line: '#b9b29f', ornament: 'leaf' },
    classic: { name: 'Classic', bg: '#ffffff', ink: '#1a1a1a', leaf: '#1a1a1a', line: '#1a1a1a', ornament: 'rule' },
    blush: { name: 'Blush', bg: '#f8e8e4', ink: '#5b3a3a', leaf: '#c4958d', line: '#d8b6ad', ornament: 'leaf' },
    champagne: { name: 'Champagne', bg: '#efe6d5', ink: '#4a3b24', leaf: '#b39a62', line: '#b39a62', ornament: 'leaf' },
    navy: { name: 'Navy', bg: '#1c2839', ink: '#efe7d6', leaf: '#9db3a3', line: '#c9b98f', ornament: 'leaf' },
  },
  draw(e) {
    const { ctx, W, H, u, pt, pal, T, jumbo } = e;
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);
    paper(ctx, 0, 0, W, H, 81, { fibres: 0.03, tooth: 0.02, dark: pal.bg < '#5' });
    const b = u(jumbo ? 0.16 : 0.08);
    frameRect(ctx, b, b, W - b * 2, H - b * 2, pal.line, pt(0.9));
    frameRect(ctx, b + u(0.035), b + u(0.035), W - (b + u(0.035)) * 2, H - (b + u(0.035)) * 2, pal.line, pt(0.35));

    // crest (or the event logo)
    const head = u(jumbo ? 0.95 : 0.66);
    const cx = W / 2, cy = head * 0.55, cr = u(jumbo ? 0.3 : 0.2);
    if (!(T.logo && logo(ctx, T.logo, cx - u(jumbo ? 0.9 : 0.6), head * 0.2, u(jumbo ? 1.8 : 1.2), head * 0.68))) {
      ctx.strokeStyle = pal.line; ctx.lineWidth = pt(0.7);
      ctx.beginPath(); ctx.arc(cx, cy, cr, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, cr * 0.86, 0, TAU); ctx.stroke();
      text(ctx, monogram(T.headline), cx, cy + cr * 0.3, { size: cr * 0.9, font: FONTS.didot, style: 'italic', color: pal.ink, align: 'center', maxW: cr * 1.5 });
      if (pal.ornament === 'leaf') {
        sprig(ctx, cx - cr * 1.15, cy + cr * 0.15, cr * 1.6, Math.PI + 0.25, pal.leaf, { flip: -1, leaves: 6 });
        sprig(ctx, cx + cr * 1.15, cy + cr * 0.15, cr * 1.6, -0.25, pal.leaf, { flip: 1, leaves: 6 });
      } else {
        rule(ctx, b + u(0.2), cy, cx - cr * 1.4, cy, pal.line, pt(0.5));
        rule(ctx, cx + cr * 1.4, cy, W - b - u(0.2), cy, pal.line, pt(0.5));
      }
    }

    const m = u(jumbo ? 0.42 : 0.2), foot = u(jumbo ? 1.45 : 1.1), gap = u(jumbo ? 0.14 : 0.09);
    const slots = e.arrange({ x: m, y: head, w: W - m * 2, h: H - head - foot }, gap);
    slots.forEach(s => {
      e.track(s);
      photo(ctx, e.img(s.i), s, { tone: e.tone, focal: e.focal });
      frameRect(ctx, s.x - u(0.025), s.y - u(0.025), s.w + u(0.05), s.h + u(0.05), pal.line, pt(0.45));
    });

    const fy = H - foot;
    const names = T.event || T.name || T.headline;
    text(ctx, names, W / 2, fy + u(jumbo ? 0.5 : 0.4), { size: pt(jumbo ? 34 : 21), font: FONTS.script, color: pal.ink, align: 'center', maxW: W - m * 1.8 });
    text(ctx, T.date.roman, W / 2, fy + u(jumbo ? 0.78 : 0.62), { size: pt(jumbo ? 9 : 7), font: FONTS.serif, tracking: 0.3, color: pal.ink, align: 'center' });
    const msg = T.message || 'Thank you for celebrating with us';
    // Jumbo sets it as tracked caps; a 2x6 is too narrow, so it's set in italic
    // upper-and-lower case, which carries the same sentence in ~3/4 the width
    if (jumbo) text(ctx, msg, W / 2, fy + u(0.98), { size: pt(7), font: FONTS.avenir, weight: 500, tracking: 0.22, upper: true, color: hexA(pal.ink, 0.7), align: 'center', maxW: W - m * 2.2 });
    else text(ctx, msg, W / 2, fy + u(0.8), { size: pt(7), font: FONTS.serif, style: 'italic', color: hexA(pal.ink, 0.75), align: 'center', maxW: W - u(0.26) });
    if (pal.ornament === 'leaf') {
      const sy = fy + u(jumbo ? 0.38 : 0.3);
      sprig(ctx, m - u(0.02), sy, u(jumbo ? 0.5 : 0.24), -0.5, hexA(pal.leaf, 0.85), { leaves: 4 });
      sprig(ctx, W - m + u(0.02), sy, u(jumbo ? 0.5 : 0.24), Math.PI + 0.5, hexA(pal.leaf, 0.85), { leaves: 4, flip: -1 });
    }
    brand(ctx, W / 2, H - b - u(jumbo ? 0.12 : 0.08), pt(jumbo ? 6 : 5.2), hexA(pal.ink, 0.6), { tracking: 0.42, weight: 500 });
  },
};

function monogram(str) {
  const parts = String(str).split(/\s*(?:&|\+|and)\s*/i).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}&${parts[1][0]}`.toUpperCase();
  return (String(str).trim()[0] || 'H').toUpperCase();
}

/* ============================================================== L STREET */

export const street = {
  id: 'street', letter: 'L', name: 'Street Issue',
  blurb: 'Urban streetwear. Heavy type, spray mist, a name-tag slap.',
  defaultHeadline: 'No Sleep Club',
  palettes: {
    concrete: { name: 'Concrete', bg: '#9b9a96', ink: '#0d0d0d', paint: '#0d0d0d', accent: '#e9e9e9', chrome: true },
    blackout: { name: 'Blackout', bg: '#0c0c0c', ink: '#f2f2f2', paint: '#f2f2f2', accent: '#bfc3c9', chrome: true },
    hazard: { name: 'Hazard', bg: '#0c0c0c', ink: '#ffffff', paint: '#ff5a1f', accent: '#ff5a1f' },
    acid: { name: 'Acid', bg: '#d7ff3a', ink: '#0c0c0c', paint: '#0c0c0c', accent: '#0c0c0c' },
  },
  draw(e) {
    const { ctx, W, H, u, pt, pal, T, jumbo, n } = e;
    const r = rng(e.seed + 91);
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);
    // concrete / poster tooth
    paper(ctx, 0, 0, W, H, 91, { fibres: 0.12, tooth: 0.09, dark: pal.bg < '#5' });
    halftone(ctx, 0, H * 0.55, W, H * 0.45, u(jumbo ? 0.07 : 0.05), hexA(pal.paint, 0.18), { from: 0, to: 1, angle: 0 });
    // spray mist in two corners
    for (const [x, y] of [[0, 0], [W, H * 0.5]]) {
      ctx.fillStyle = rad(ctx, x, y, 0, u(jumbo ? 1.4 : 0.9), [[0, hexA(pal.paint, 0.35)], [1, hexA(pal.paint, 0)]]);
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 160; i++) { const a = r() * TAU, d = r() * u(jumbo ? 1.4 : 0.9); ctx.fillStyle = hexA(pal.paint, 0.5 * r()); ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, u(0.006) * (1 + r() * 2), 0, TAU); ctx.fill(); }
    }

    // header bar with drips
    const head = u(jumbo ? 0.95 : 0.68);
    ctx.fillStyle = pal.paint; ctx.fillRect(0, 0, W, head * 0.82);
    for (let i = 0; i < (jumbo ? 9 : 6); i++) {
      const x = u(0.1) + r() * (W - u(0.2)), len = u(0.06) + r() * u(jumbo ? 0.4 : 0.26), w = u(0.02) + r() * u(0.025);
      roundRect(ctx, x, head * 0.78, w, len, w / 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + w / 2, head * 0.78 + len, w * 0.75, 0, TAU); ctx.fill();
    }
    const knock = pal.paint === pal.ink ? pal.bg : pal.bg;
    text(ctx, T.headline, W / 2, head * 0.6, { size: pt(jumbo ? 40 : 25), font: FONTS.impact, color: knock === '#d7ff3a' ? '#d7ff3a' : (pal.paint === '#0d0d0d' ? '#e9e9e9' : pal.paint === '#ff5a1f' ? '#0c0c0c' : knock), upper: true, tracking: 0.01, align: 'center', maxW: W - u(jumbo ? 0.4 : 0.18) });

    const side = u(jumbo ? 0.42 : 0.24), m = u(jumbo ? 0.26 : 0.1), foot = u(jumbo ? 0.95 : 0.9), gap = u(jumbo ? 0.14 : 0.09);
    const region = { x: side, y: head + u(0.06), w: W - side - m, h: H - head - foot - u(0.06) };
    const slots = e.arrange(region, gap, { maxA: 1.55 });
    slots.forEach((s, i) => {
      e.track(s);
      ctx.fillStyle = pal.ink === '#0c0c0c' || pal.ink === '#0d0d0d' ? '#0c0c0c' : '#000000';
      ctx.fillRect(s.x - pt(2.5), s.y - pt(2.5), s.w + pt(5), s.h + pt(5));
      photo(ctx, e.img(s.i), s, { tone: e.tone, focal: e.focal });
      text(ctx, `${String(i + 1).padStart(2, '0')}`, s.x + s.w - u(0.03), s.y + s.h + pt(2.5) + pt(jumbo ? 8 : 6.5), { size: pt(jumbo ? 8 : 6.5), font: FONTS.impact, color: pal.ink, align: 'right' });
    });
    // vertical side type
    vtext(ctx, `HOLOBOOTH  ·  VOL.${String(T.date.y).slice(2)}  ·  ${n} SHOTS`, side / 2, region.y + region.h / 2, -1, { size: pt(jumbo ? 9 : 6.5), font: FONTS.condensed, weight: 700, color: pal.ink, tracking: 0.3, align: 'center', maxW: region.h * 0.95 });

    // footer: name-tag slap, barcode
    const fy = H - foot;
    const tw = Math.min(W - m * 2 - u(jumbo ? 1.0 : 0.1), u(jumbo ? 2.1 : 1.55)), th = foot * (jumbo ? 0.62 : 0.6);
    const tx = jumbo ? side : (W - tw) / 2, ty = fy + u(0.1);
    ctx.save(); ctx.translate(tx + tw / 2, ty + th / 2); ctx.rotate(-0.04); ctx.translate(-(tx + tw / 2), -(ty + th / 2));
    shadowed(ctx, 'rgba(0,0,0,.35)', u(0.03), 0, u(0.015), () => { ctx.fillStyle = '#ffffff'; roundRect(ctx, tx, ty, tw, th, u(0.04)); ctx.fill(); });
    ctx.fillStyle = pal.accent === '#e9e9e9' || pal.accent === '#bfc3c9' ? '#1a1a1a' : pal.accent;
    roundRect(ctx, tx, ty, tw, th * 0.36, u(0.04)); ctx.fill(); ctx.fillRect(tx, ty + th * 0.2, tw, th * 0.16);
    text(ctx, 'HELLO, MY NAME IS', tx + tw / 2, ty + th * 0.26, { size: pt(jumbo ? 8 : 6), font: FONTS.black, weight: 900, color: '#ffffff', align: 'center', tracking: 0.1, maxW: tw * 0.9 });
    text(ctx, T.name || T.event || 'Main Character', tx + tw / 2, ty + th * 0.82, { size: pt(jumbo ? 20 : 14), font: FONTS.marker, color: '#111111', align: 'center', maxW: tw * 0.88 });
    ctx.restore();
    if (jumbo) {
      const bx = W - m - u(0.95);
      ctx.fillStyle = pal.ink;
      for (let x = bx, k = 0; x < W - m; k++) { const w2 = u(0.008) * (1 + (k * 7 % 3)); if (k % 3 !== 2) ctx.fillRect(x, fy + u(0.18), w2, u(0.32)); x += w2 + u(0.012); }
      text(ctx, T.date.dots, W - m, fy + u(0.66), { size: pt(8), font: FONTS.condensed, weight: 700, tracking: 0.2, color: pal.ink, align: 'right' });
    } else {
      text(ctx, T.date.dots, W - m, H - u(0.08), { size: pt(6), font: FONTS.condensed, weight: 700, tracking: 0.2, color: pal.ink, align: 'right' });
    }
    brand(ctx, jumbo ? W - m : m + u(0.02), H - u(jumbo ? 0.14 : 0.08), pt(jumbo ? 6.5 : 5.4), pal.ink, { align: jumbo ? 'right' : 'left', font: FONTS.condensed, weight: 700, tracking: 0.3 });
  },
};
