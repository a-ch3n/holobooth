/** Synthetic photobooth shots so frames can be reviewed without a camera. */
export function drawFakePhoto(ctx, W, H, variant = 0) {
  const palettes = [
    ['#ff8fb1', '#ffd66b', '#7ad7f0'],
    ['#8f7dff', '#54e0c7', '#ffe27a'],
    ['#ff6f61', '#ffb56b', '#5ec5ff'],
    ['#2b2f4a', '#6f5da8', '#f2a6c3'],
  ];
  const p = palettes[variant % palettes.length];
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, p[0]); g.addColorStop(0.55, p[1]); g.addColorStop(1, p[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // curtain ribs
  ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = '#000';
  for (let x = 0; x < W; x += W / 14) ctx.fillRect(x, 0, W / 40, H);
  ctx.restore();

  // bokeh
  let s = 1234 + variant * 77;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = '#fff';
  for (let i = 0; i < 18; i++) {
    ctx.beginPath(); ctx.arc(rnd() * W, rnd() * H * 0.7, rnd() * W * 0.05 + W * 0.01, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // two friends, head + shoulders
  const people = [
    { x: W * 0.36, scale: 1.0, skin: '#3b2a24' },
    { x: W * 0.64, scale: 0.92, skin: '#2a2230' },
  ];
  people.forEach((pe, i) => {
    const hr = W * 0.13 * pe.scale;
    const hy = H * (0.42 + i * 0.03);
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.beginPath(); ctx.ellipse(pe.x + W * 0.01, hy + hr * 0.2, hr * 1.05, hr * 1.1, 0, 0, Math.PI * 2); ctx.fill();
    // body
    ctx.fillStyle = pe.skin;
    ctx.beginPath();
    ctx.moveTo(pe.x - hr * 2.1, H);
    ctx.quadraticCurveTo(pe.x - hr * 1.5, hy + hr * 1.1, pe.x, hy + hr * 0.95);
    ctx.quadraticCurveTo(pe.x + hr * 1.5, hy + hr * 1.1, pe.x + hr * 2.1, H);
    ctx.closePath(); ctx.fill();
    // head
    ctx.beginPath(); ctx.arc(pe.x, hy, hr, 0, Math.PI * 2); ctx.fill();
    // hair cap
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.arc(pe.x, hy - hr * 0.18, hr * 1.02, Math.PI, 0); ctx.fill();
    // prop: sunglasses / peace hand
    if (i === 0) {
      ctx.fillStyle = 'rgba(0,0,0,.7)';
      ctx.fillRect(pe.x - hr * 0.75, hy - hr * 0.16, hr * 1.5, hr * 0.32);
    } else {
      ctx.strokeStyle = pe.skin; ctx.lineWidth = hr * 0.22; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pe.x + hr * 1.5, hy + hr * 1.3);
      ctx.lineTo(pe.x + hr * 1.25, hy + hr * 0.35);
      ctx.moveTo(pe.x + hr * 1.5, hy + hr * 1.3);
      ctx.lineTo(pe.x + hr * 1.85, hy + hr * 0.4);
      ctx.stroke();
    }
  });

  // slight vignette + warmth
  const v = ctx.createRadialGradient(W / 2, H * 0.45, W * 0.2, W / 2, H * 0.5, W * 0.8);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.34)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

/** Placeholder for a limited-drop hand-drawn character (a chunky mascot blob). */
export function drawFakeCharacter(ctx, W, H, hue = 265) {
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H * 0.56, r = W * 0.38;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#2b2233'; ctx.lineWidth = W * 0.045;
  ctx.fillStyle = `hsl(${hue},85%,88%)`;
  // body
  ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 1.05, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // ears
  [-1, 1].forEach(d => {
    ctx.beginPath(); ctx.ellipse(cx + d * r * 0.62, cy - r * 0.82, r * 0.26, r * 0.4, d * 0.4, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  });
  // face
  ctx.fillStyle = '#2b2233';
  [-1, 1].forEach(d => { ctx.beginPath(); ctx.arc(cx + d * r * 0.32, cy - r * 0.12, r * 0.075, 0, Math.PI * 2); ctx.fill(); });
  ctx.beginPath(); ctx.arc(cx, cy + r * 0.14, r * 0.16, 0.15 * Math.PI, 0.85 * Math.PI); ctx.lineWidth = W * 0.028; ctx.stroke();
  ctx.fillStyle = `hsl(${(hue + 320) % 360},90%,78%)`;
  [-1, 1].forEach(d => { ctx.beginPath(); ctx.ellipse(cx + d * r * 0.58, cy + r * 0.06, r * 0.14, r * 0.09, 0, 0, Math.PI * 2); ctx.fill(); });
  // little sword (mochi knight energy)
  ctx.strokeStyle = '#2b2233'; ctx.lineWidth = W * 0.035;
  ctx.beginPath(); ctx.moveTo(cx + r * 0.95, cy + r * 0.5); ctx.lineTo(cx + r * 1.25, cy - r * 0.45); ctx.stroke();
}
