/**
 * placeholder.mjs — stand-in booth photos for previews, proofs and mockups.
 *
 * A real booth session is the same people across every frame, changing pose
 * each time: straight smile, laugh, peace sign, silly face, squeeze-in hug.
 * So a placeholder is a *session* (backdrop + cast) and a *frame index*
 * (pose + expression). That makes a strip read like a strip in a proof, and
 * it means the photo areas are judged at real booth proportions — a 3:2
 * landscape capture, cover-cropped into each slot — rather than against a
 * decorative pattern.
 *
 * Drawn, not photographed: no model releases, no stock licences, and it runs
 * identically in the kiosk and in node. Canvas-agnostic like everything else.
 */

const TAU = Math.PI * 2;

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = s => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
  const [r1, g1, b1] = ch(pa), [r2, g2, b2] = ch(pb);
  const r = Math.round(r1 + (r2 - r1) * t), g = Math.round(g1 + (g2 - g1) * t), bl = Math.round(b1 + (b2 - b1) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/* Skin tones span the range a public booth actually sees. */
const SKIN = ['#f3d2bd', '#e8b996', '#d29c78', '#b97a55', '#8d5a3b', '#5f3a26', '#f0c7a6', '#c68c64'];
const HAIR = ['#1b1512', '#2c1d16', '#4a2f1f', '#6b4428', '#a8743f', '#d7b27a', '#241a14', '#8a3b2a'];
const CLOTH = ['#1f2533', '#f2efe8', '#c8423b', '#2f6b5a', '#e9b84a', '#7d5ba6', '#d77fa1', '#3d6fb6', '#e8e1d6', '#262626'];

const BACKDROPS = [
  { kind: 'seamless', a: '#d9d4cc', b: '#b9b2a8' },     // warm grey studio paper
  { kind: 'seamless', a: '#f1e7dc', b: '#d8c6b4' },     // cream
  { kind: 'curtain', a: '#5b1f2b', b: '#2e0f16' },      // velvet booth curtain
  { kind: 'seamless', a: '#cfe0ea', b: '#9fb9c8' },     // cool blue paper
  { kind: 'sequin', a: '#c9b28a', b: '#7d6a4c' },       // gold party wall
  { kind: 'seamless', a: '#ead3d8', b: '#c9a7ae' },     // blush
  { kind: 'curtain', a: '#20242c', b: '#0e1014' },      // black curtain
  { kind: 'seamless', a: '#e7e7e3', b: '#c4c4be' },     // white-ish
];

/** Session = who is in the booth and what is behind them. */
export function makeSession(seed = 1) {
  const r = rng(seed * 7919 + 13);
  const count = r() < 0.18 ? 1 : r() < 0.78 ? 2 : 3;
  const cast = [];
  for (let i = 0; i < count; i++) {
    cast.push({
      skin: SKIN[Math.floor(r() * SKIN.length)],
      hair: HAIR[Math.floor(r() * HAIR.length)],
      style: ['short', 'long', 'bob', 'bun', 'curly', 'long', 'short'][Math.floor(r() * 7)],
      cloth: CLOTH[Math.floor(r() * CLOTH.length)],
      neck: r() < 0.5 ? 'crew' : 'v',
      glasses: r() < 0.15,
      scale: 0.92 + r() * 0.14,
      height: (r() - 0.5) * 0.08,
    });
  }
  return { seed, cast, backdrop: BACKDROPS[Math.floor(r() * BACKDROPS.length)] };
}

/* ---------------------------------------------------------------- scene */

function drawBackdrop(ctx, W, H, bd, r) {
  const g = ctx.createRadialGradient(W * 0.5, H * 0.38, W * 0.05, W * 0.5, H * 0.5, W * 0.85);
  g.addColorStop(0, bd.a); g.addColorStop(1, bd.b);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  if (bd.kind === 'curtain') {
    // soft vertical folds
    const folds = 11;
    for (let i = 0; i < folds; i++) {
      const x = (i / folds) * W;
      const fg = ctx.createLinearGradient(x, 0, x + W / folds, 0);
      fg.addColorStop(0, 'rgba(0,0,0,.28)');
      fg.addColorStop(0.45, 'rgba(255,255,255,.07)');
      fg.addColorStop(1, 'rgba(0,0,0,.28)');
      ctx.fillStyle = fg; ctx.fillRect(x, 0, W / folds + 1, H);
    }
  } else if (bd.kind === 'sequin') {
    for (let i = 0; i < 900; i++) {
      const x = r() * W, y = r() * H, s = W * (0.004 + r() * 0.006);
      ctx.fillStyle = `rgba(255,${230 + r() * 25 | 0},${170 + r() * 60 | 0},${0.15 + r() * 0.5})`;
      ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill();
    }
  } else {
    // seamless paper: floor sweep
    const fg = ctx.createLinearGradient(0, H * 0.7, 0, H);
    fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(1, 'rgba(0,0,0,.10)');
    ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
  }
}

/* ---------------------------------------------------------------- people */

function hairBack(ctx, p, x, y, hr) {
  ctx.fillStyle = p.hair;
  if (p.style === 'long') {
    ctx.beginPath();
    ctx.moveTo(x - hr * 1.05, y - hr * 0.2);
    ctx.bezierCurveTo(x - hr * 1.35, y + hr * 1.2, x - hr * 1.2, y + hr * 2.2, x - hr * 0.6, y + hr * 2.4);
    ctx.lineTo(x + hr * 0.6, y + hr * 2.4);
    ctx.bezierCurveTo(x + hr * 1.2, y + hr * 2.2, x + hr * 1.35, y + hr * 1.2, x + hr * 1.05, y - hr * 0.2);
    ctx.closePath(); ctx.fill();
  } else if (p.style === 'bob') {
    ctx.beginPath();
    ctx.ellipse(x, y + hr * 0.25, hr * 1.22, hr * 1.18, 0, 0, TAU); ctx.fill();
  } else if (p.style === 'curly') {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * hr * 1.02, y - hr * 0.08 + Math.sin(a) * hr * 1.08, hr * 0.42, 0, TAU);
      ctx.fill();
    }
  } else if (p.style === 'bun') {
    ctx.beginPath(); ctx.arc(x, y - hr * 1.12, hr * 0.42, 0, TAU); ctx.fill();
  }
}

function hairFront(ctx, p, x, y, hr) {
  ctx.fillStyle = p.hair;
  ctx.beginPath();
  if (p.style === 'short') {
    // close crop that follows the skull, with a soft side part
    ctx.moveTo(x - hr * 0.92, y - hr * 0.05);
    ctx.bezierCurveTo(x - hr * 1.0, y - hr * 1.15, x + hr * 1.0, y - hr * 1.2, x + hr * 0.92, y - hr * 0.05);
    ctx.quadraticCurveTo(x + hr * 0.82, y - hr * 0.5, x + hr * 0.35, y - hr * 0.58);
    ctx.quadraticCurveTo(x - hr * 0.2, y - hr * 0.72, x - hr * 0.6, y - hr * 0.45);
    ctx.quadraticCurveTo(x - hr * 0.85, y - hr * 0.3, x - hr * 0.92, y - hr * 0.05);
  } else if (p.style === 'curly') {
    ctx.ellipse(x, y - hr * 0.45, hr * 1.06, hr * 0.7, 0, Math.PI, TAU);
    ctx.quadraticCurveTo(x, y - hr * 0.35, x - hr * 1.06, y - hr * 0.45);
  } else {
    // parted fringe that frames the face
    ctx.moveTo(x - hr * 1.02, y + hr * 0.25);
    ctx.bezierCurveTo(x - hr * 1.12, y - hr * 1.2, x + hr * 1.12, y - hr * 1.25, x + hr * 1.02, y + hr * 0.25);
    ctx.quadraticCurveTo(x + hr * 0.75, y - hr * 0.55, x + hr * 0.05, y - hr * 0.62);
    ctx.quadraticCurveTo(x - hr * 0.7, y - hr * 0.5, x - hr * 1.02, y + hr * 0.25);
  }
  ctx.closePath(); ctx.fill();
  // sheen
  const sh = ctx.createLinearGradient(x - hr, y - hr, x + hr * 0.4, y - hr * 0.2);
  sh.addColorStop(0, 'rgba(255,255,255,.16)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sh; ctx.fill();
}

function face(ctx, p, x, y, hr, expr) {
  const ink = mix(p.skin, '#1a0f0a', 0.78);
  // eyes
  const ey = y - hr * 0.02, ex = hr * 0.36;
  if (p.glasses || expr === 'shades') {
    ctx.fillStyle = expr === 'shades' ? '#111' : 'rgba(30,30,30,.0)';
    ctx.strokeStyle = '#151515'; ctx.lineWidth = hr * 0.07;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(x + s * ex, ey, hr * 0.27, hr * 0.21, 0, 0, TAU);
      if (expr === 'shades') ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(x - ex + hr * 0.27, ey); ctx.lineTo(x + ex - hr * 0.27, ey); ctx.stroke();
  }
  if (expr !== 'shades') {
    for (const s of [-1, 1]) {
      if (expr === 'laugh' || (expr === 'wink' && s === 1)) {
        ctx.strokeStyle = ink; ctx.lineWidth = hr * 0.07; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(x + s * ex, ey + hr * 0.05, hr * 0.13, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      } else {
        ctx.fillStyle = ink;
        ctx.beginPath(); ctx.ellipse(x + s * ex, ey, hr * 0.085, hr * (expr === 'wow' ? 0.13 : 0.105), 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.beginPath(); ctx.arc(x + s * ex + hr * 0.03, ey - hr * 0.04, hr * 0.028, 0, TAU); ctx.fill();
      }
    }
  }
  // brows
  ctx.strokeStyle = mix(p.hair, '#000', 0.2); ctx.lineWidth = hr * 0.06; ctx.lineCap = 'round';
  const by = ey - hr * (expr === 'wow' ? 0.34 : 0.25);
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(x + s * (ex - hr * 0.14), by + hr * 0.02); ctx.quadraticCurveTo(x + s * ex, by - hr * 0.05, x + s * (ex + hr * 0.15), by + hr * 0.03); ctx.stroke();
  }
  // nose shadow
  ctx.strokeStyle = mix(p.skin, '#3a1d10', 0.28); ctx.lineWidth = hr * 0.05;
  ctx.beginPath(); ctx.moveTo(x + hr * 0.02, y + hr * 0.08); ctx.quadraticCurveTo(x + hr * 0.1, y + hr * 0.26, x - hr * 0.04, y + hr * 0.3); ctx.stroke();
  // cheeks
  ctx.fillStyle = 'rgba(230,90,90,.16)';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + s * hr * 0.5, y + hr * 0.3, hr * 0.17, hr * 0.1, 0, 0, TAU); ctx.fill(); }
  // mouth
  const my = y + hr * 0.5;
  if (expr === 'laugh' || expr === 'wow') {
    ctx.fillStyle = '#4a1a1a';
    ctx.beginPath();
    if (expr === 'wow') ctx.ellipse(x, my, hr * 0.12, hr * 0.16, 0, 0, TAU);
    else { ctx.moveTo(x - hr * 0.3, my - hr * 0.06); ctx.quadraticCurveTo(x, my + hr * 0.42, x + hr * 0.3, my - hr * 0.06); ctx.closePath(); }
    ctx.fill();
    if (expr === 'laugh') {
      ctx.fillStyle = '#fbf7f2';
      ctx.beginPath(); ctx.moveTo(x - hr * 0.25, my - hr * 0.04); ctx.quadraticCurveTo(x, my + hr * 0.06, x + hr * 0.25, my - hr * 0.04); ctx.closePath(); ctx.fill();
    }
  } else if (expr === 'kiss') {
    ctx.fillStyle = mix(p.skin, '#a0303a', 0.6);
    ctx.beginPath(); ctx.ellipse(x + hr * 0.04, my, hr * 0.08, hr * 0.07, 0, 0, TAU); ctx.fill();
  } else {
    ctx.strokeStyle = mix(p.skin, '#5a1c1c', 0.7); ctx.lineWidth = hr * 0.07; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - hr * 0.26, my - hr * 0.04); ctx.quadraticCurveTo(x, my + hr * 0.2, x + hr * 0.26, my - hr * 0.04); ctx.stroke();
  }
}

function hand(ctx, p, x, y, s, rot, kind) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = p.skin;
  ctx.strokeStyle = mix(p.skin, '#3a1d10', 0.25); ctx.lineWidth = s * 0.04;
  // palm
  ctx.beginPath(); ctx.ellipse(0, 0, s * 0.32, s * 0.36, 0, 0, TAU); ctx.fill();
  const finger = (fx, len, ang) => {
    ctx.save(); ctx.translate(fx, -s * 0.18); ctx.rotate(ang);
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-s * 0.075, -len, s * 0.15, len, s * 0.075) : ctx.rect(-s * 0.075, -len, s * 0.15, len);
    ctx.fill(); ctx.restore();
  };
  if (kind === 'peace') { finger(-s * 0.08, s * 0.62, -0.22); finger(s * 0.1, s * 0.6, 0.2); }
  else if (kind === 'wave') { [-0.2, -0.07, 0.07, 0.2].forEach((f, i) => finger(f * s, s * (0.5 + (i === 1 || i === 2 ? 0.08 : 0)), f * 0.8)); }
  // sleeve cuff hint
  ctx.restore();
}

function person(ctx, p, x, baseY, hr, pose, idx) {
  const { expr, tilt = 0, gesture = null } = pose;
  const y = baseY;
  ctx.save();
  // shoulders + torso
  const sw = hr * 2.35;
  const cg = ctx.createLinearGradient(x - sw, y + hr, x + sw, y + hr * 4);
  cg.addColorStop(0, mix(p.cloth, '#ffffff', 0.12)); cg.addColorStop(1, mix(p.cloth, '#000000', 0.28));
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.moveTo(x - sw, y + hr * 5);
  ctx.bezierCurveTo(x - sw * 1.02, y + hr * 1.75, x - sw * 0.55, y + hr * 1.2, x, y + hr * 1.18);
  ctx.bezierCurveTo(x + sw * 0.55, y + hr * 1.2, x + sw * 1.02, y + hr * 1.75, x + sw, y + hr * 5);
  ctx.closePath(); ctx.fill();
  // neck
  ctx.fillStyle = mix(p.skin, '#3a1d10', 0.18);
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - hr * 0.3, y + hr * 0.6, hr * 0.6, hr * 0.75, hr * 0.2) : ctx.rect(x - hr * 0.3, y + hr * 0.6, hr * 0.6, hr * 0.75); ctx.fill();
  // neckline
  ctx.fillStyle = mix(p.skin, '#3a1d10', 0.1);
  ctx.beginPath();
  if (p.neck === 'v') { ctx.moveTo(x - hr * 0.42, y + hr * 1.2); ctx.lineTo(x, y + hr * 1.85); ctx.lineTo(x + hr * 0.42, y + hr * 1.2); }
  else ctx.ellipse(x, y + hr * 1.2, hr * 0.42, hr * 0.2, 0, 0, Math.PI);
  ctx.fill();

  ctx.translate(x, y); ctx.rotate(tilt); ctx.translate(-x, -y);
  hairBack(ctx, p, x, y, hr);
  // ears
  ctx.fillStyle = mix(p.skin, '#3a1d10', 0.08);
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + s * hr * 0.92, y + hr * 0.05, hr * 0.14, hr * 0.22, 0, 0, TAU); ctx.fill(); }
  // head, lit from upper left
  const hg = ctx.createRadialGradient(x - hr * 0.35, y - hr * 0.4, hr * 0.1, x, y, hr * 1.25);
  hg.addColorStop(0, mix(p.skin, '#ffffff', 0.16)); hg.addColorStop(0.7, p.skin); hg.addColorStop(1, mix(p.skin, '#2a140a', 0.25));
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.ellipse(x, y, hr * 0.9, hr * 1.06, 0, 0, TAU); ctx.fill();
  face(ctx, p, x, y, hr, expr);
  hairFront(ctx, p, x, y, hr);
  ctx.restore();

  if (gesture === 'peace') hand(ctx, p, x + hr * 1.35 * (idx % 2 ? 1 : -1), y + hr * 0.9, hr * 1.05, (idx % 2 ? 0.25 : -0.25), 'peace');
  if (gesture === 'wave') hand(ctx, p, x + hr * 1.5 * (idx % 2 ? 1 : -1), y + hr * 0.4, hr * 1.0, (idx % 2 ? 0.2 : -0.2), 'wave');
}

const POSES = [
  // 0: straight smile
  cast => cast.map(() => ({ expr: 'smile' })),
  // 1: big laugh, leaning in
  cast => cast.map((_, i) => ({ expr: 'laugh', tilt: (i - (cast.length - 1) / 2) * -0.16, lean: 1 })),
  // 2: peace signs
  cast => cast.map((_, i) => ({ expr: i % 2 ? 'wink' : 'smile', gesture: i === 0 || cast.length === 1 ? 'peace' : (i === cast.length - 1 ? 'peace' : null) })),
  // 3: silly
  cast => cast.map((_, i) => ({ expr: ['wow', 'shades', 'kiss'][i % 3], tilt: (i % 2 ? 0.12 : -0.1) })),
  // 4: squeeze in + wave
  cast => cast.map((_, i) => ({ expr: 'laugh', tilt: (i - (cast.length - 1) / 2) * -0.22, lean: 1.6, gesture: i === cast.length - 1 ? 'wave' : null })),
];

/**
 * Draw one booth frame. `session` from makeSession(); `frame` picks the pose.
 * 3:2 landscape is what the booth cameras deliver; any size works.
 */
export function drawBoothPhoto(ctx, W, H, session, frame = 0, opts = {}) {
  const r = rng(session.seed * 31 + frame * 101 + 7);
  ctx.save();
  drawBackdrop(ctx, W, H, session.backdrop, rng(session.seed));

  const cast = session.cast;
  const pose = POSES[frame % POSES.length](cast);
  const n = cast.length;
  const hrBase = Math.min(W, H) * (n === 1 ? 0.2 : n === 2 ? 0.165 : 0.135);
  const spread = n === 1 ? 0 : W * (n === 2 ? 0.25 : 0.27);
  // stand back-to-front so the middle person overlaps a little
  const order = [...cast.keys()].sort((a, b) => Math.abs(b - (n - 1) / 2) - Math.abs(a - (n - 1) / 2));
  for (const i of order) {
    const p = cast[i];
    const ps = pose[i];
    const lean = (ps.lean || 0) * W * 0.03 * (i < (n - 1) / 2 ? 1 : i > (n - 1) / 2 ? -1 : 0);
    const cx = W / 2 + (n === 1 ? 0 : (i - (n - 1) / 2) * spread) + lean + (r() - 0.5) * W * 0.012;
    const hr = hrBase * p.scale;
    const cy = H * (0.44 + p.height) + (r() - 0.5) * H * 0.02;
    person(ctx, p, cx, cy, hr, ps, i);
  }

  // studio light: key from upper left, soft falloff, gentle vignette
  const key = ctx.createRadialGradient(W * 0.3, H * 0.15, 0, W * 0.3, H * 0.15, W * 0.9);
  key.addColorStop(0, 'rgba(255,248,235,.12)'); key.addColorStop(1, 'rgba(255,248,235,0)');
  ctx.fillStyle = key; ctx.fillRect(0, 0, W, H);
  const v = ctx.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.28)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);

  // sensor noise, so it reads as a capture rather than vector art
  if (opts.noise !== false) {
    const nr = rng(session.seed + frame);
    for (let i = 0; i < (W * H) / 260; i++) {
      ctx.fillStyle = nr() < 0.5 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.05)';
      ctx.fillRect(nr() * W, nr() * H, 1.5, 1.5);
    }
  }
  ctx.restore();
}

/**
 * A set of booth frames as canvases from `factory(w,h)`. Defaults to 3:2.
 * Used by the proof/mockup tools and the kiosk picker thumbnails.
 */
export function boothSession(factory, { seed = 1, count = 5, width = 900, height = 600 } = {}) {
  const session = makeSession(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const c = factory(width, height);
    drawBoothPhoto(c.getContext('2d'), width, height, session, i);
    out.push(c);
  }
  return out;
}
