/**
 * Builds a self-contained HTML gallery of the whole set, with card images and
 * energy pips embedded as data URIs so the page stands alone.
 *
 *   node tools/render-all.mjs && node tools/build-gallery.mjs
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKS, allFrames, RARITIES, RARITY_ORDER, isAvailable, SET, ENERGY, ENERGY_IDS, energy, frameBox } from '../src/js/frames/packs.mjs';
import { energyPip } from '../src/js/frames/energy.mjs';
import { setCanvasFactory } from '../src/js/frames/draw.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const framesDir = join(root, 'out', 'frames');
mkdirSync(join(root, 'out'), { recursive: true });
setCanvasFactory((w, h) => createCanvas(w, h));

async function jpeg(file, w, h, q = 84) {
  const img = await loadImage(readFileSync(join(framesDir, file)));
  const c = createCanvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#0c0e14'; x.fillRect(0, 0, w, h);
  x.drawImage(img, 0, 0, w, h);
  return 'data:image/jpeg;base64,' + c.toBuffer('image/jpeg', q).toString('base64');
}

function pipPng(typeId, size = 96) {
  const c = createCanvas(size, size);
  energyPip(c.getContext('2d'), typeId, size / 2, size / 2, size / 2 - 3);
  return 'data:image/png;base64,' + c.toBuffer('image/png').toString('base64');
}

const frames = allFrames();
const imgs = {};
for (const f of frames) {
  // Strips are 2:6 — sizing every frame as a card would squash them.
  const b = frameBox(f, f.template === 'strip' ? 196 : 420);
  imgs[f.id] = await jpeg(`${f.id}.png`, b.W, b.H);
}
for (const r of RARITY_ORDER) imgs[`rarity-${r}`] = await jpeg(`rarity-${r}.png`, 340, 476);
imgs.strip = await jpeg('photo-strip.png', 260, 780, 88);
const pips = Object.fromEntries(ENERGY_IDS.map(id => [id, pipPng(id)]));

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ------------------------------------------------------------ sections */

const typeChart = ENERGY_IDS.map(id => {
  const e = ENERGY[id];
  return `
  <div class="type" style="--t:${e.base}">
    <img src="${pips[id]}" alt="" width="96" height="96">
    <b>${e.name}</b>
    <span class="mono dim">weak to ${ENERGY[e.weak].name}${e.resist ? ` · resists ${ENERGY[e.resist].name}` : ''}</span>
  </div>`;
}).join('');

const packSections = PACKS.slice().sort((a, b) => a.order - b.order).map(p => {
  const fs = frames.filter(f => f.packId === p.id);
  return `
  <section class="pack" id="${p.id}">
    <header class="pack-head">
      <div>
        <h2>${esc(p.name)}${p.limited ? '<span class="tag tag-drop">limited</span>' : ''}</h2>
        <p>${esc(p.tagline)}</p>
      </div>
      <div class="pack-meta"><span class="mono">${fs.length} card${fs.length === 1 ? '' : 's'}</span></div>
    </header>
    <div class="slots">
      ${fs.map(f => {
        const live = isAvailable(f);
        const lim = f.availability;
        const e = energy(f.energyType);
        return `
      <figure class="slot${live ? '' : ' slot-off'}${f.strip ? ' slot-strip' : ''}" tabindex="0">
        <div class="sleeve">
          <img src="${imgs[f.id]}" alt="${esc(f.name)} card" loading="lazy">
          <span class="foil" aria-hidden="true"></span>
        </div>
        <figcaption>
          <b><img class="pip" src="${pips[f.energyType]}" alt="${e.name} type" width="16" height="16">${esc(f.name)}</b>
          <span class="mono dim">${f.collectorNumber}${f.strip ? ' · 2×6 strip' : (f.party || f.cutie) ? ' · personalised' : ` · ${f.hp} HP`}</span>
          ${lim ? `<span class="tag ${live ? 'tag-live' : 'tag-gone'}">${live ? `${lim.mintLimit} only · ends ${lim.end}` : `returns ${lim.start}`}</span>` : ''}
        </figcaption>
      </figure>`;
      }).join('')}
    </div>
  </section>`;
}).join('');

const ladder = RARITY_ORDER.map(id => {
  const r = RARITIES[id];
  const pct = (r.weight / RARITY_ORDER.reduce((t, k) => t + RARITIES[k].weight, 0)) * 100;
  return `
    <figure class="tier" style="--tier:${r.color}">
      <img src="${imgs['rarity-' + id]}" alt="${r.label} foil treatment" loading="lazy" width="340" height="476">
      <figcaption>
        <span class="sym">${r.symbol}</span>
        <b>${r.label}</b>
        <span class="mono dim">${pct.toFixed(1)}% · ${r.foil === 'none' ? 'no foil' : r.foil}</span>
      </figcaption>
    </figure>`;
}).join('');

const html = `<title>Pocket Pals Base Set</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Public+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap">
<style>
:root{
  --ground:#f3f5f9; --surface:#ffffff; --sunk:#e8ebf2;
  --line:#d5dae5; --line-soft:#e4e8f0;
  --ink:#151a24; --ink-2:#4c5567; --ink-3:#7c869a;
  --gold:#b0842a; --violet:#6a4fd0;
  --shadow:0 1px 2px rgba(21,26,36,.06), 0 12px 28px rgba(21,26,36,.08);
  --slot:#dfe4ee;
  --display:"Bricolage Grotesque","Trebuchet MS",system-ui,sans-serif;
  --body:"Public Sans",system-ui,-apple-system,sans-serif;
  --mono:"DM Mono",ui-monospace,"SF Mono",Menlo,monospace;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ground:#0b0d13; --surface:#141822; --sunk:#0e1219;
    --line:#242b3a; --line-soft:#1b2130;
    --ink:#e8ecf5; --ink-2:#a8b2c6; --ink-3:#78829a;
    --gold:#ffd76e; --violet:#a68cff;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 18px 44px rgba(0,0,0,.5);
    --slot:#0a0d13;
  }
}
:root[data-theme="dark"]{
  --ground:#0b0d13; --surface:#141822; --sunk:#0e1219;
  --line:#242b3a; --line-soft:#1b2130;
  --ink:#e8ecf5; --ink-2:#a8b2c6; --ink-3:#78829a;
  --gold:#ffd76e; --violet:#a68cff;
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 18px 44px rgba(0,0,0,.5);
  --slot:#0a0d13;
}

*{box-sizing:border-box}
body{margin:0; background:var(--ground); color:var(--ink); font:400 16px/1.6 var(--body); -webkit-font-smoothing:antialiased}
.wrap{max-width:1180px; margin:0 auto; padding:0 28px}
h1,h2,h3{font-family:var(--display); font-weight:800; letter-spacing:-.02em; text-wrap:balance; margin:0}
.mono{font-family:var(--mono); font-size:12.5px; letter-spacing:-.01em}
.dim{color:var(--ink-3)}

header.top{
  border-bottom:1px solid var(--line);
  background:
    radial-gradient(120% 90% at 12% 0%, color-mix(in oklab, var(--violet) 16%, transparent), transparent 62%),
    radial-gradient(90% 80% at 88% 10%, color-mix(in oklab, var(--gold) 14%, transparent), transparent 60%),
    var(--surface);
}
.top .wrap{padding-top:66px; padding-bottom:52px}
.eyebrow{font-family:var(--mono); font-size:12px; letter-spacing:.16em; text-transform:uppercase;
  color:var(--ink-3); display:flex; gap:10px; align-items:center; margin-bottom:20px}
.eyebrow s{width:26px; height:1px; background:var(--line); display:block}
h1{font-size:clamp(38px,6.2vw,66px); line-height:1.02; max-width:15ch}
h1 em{font-style:normal; color:var(--gold)}
.lede{margin:20px 0 0; max-width:60ch; font-size:18px; color:var(--ink-2)}
.stats{display:flex; flex-wrap:wrap; gap:34px; margin-top:38px; padding-top:26px; border-top:1px solid var(--line-soft)}
.stat b{display:block; font-family:var(--display); font-size:30px; line-height:1; letter-spacing:-.03em}
.stat span{font-family:var(--mono); font-size:11.5px; letter-spacing:.11em; text-transform:uppercase; color:var(--ink-3)}

/* --------------------------------------------------------- type chart */
.types-sec{padding:56px 0; border-bottom:1px solid var(--line-soft)}
.types{display:grid; gap:18px; grid-template-columns:repeat(auto-fill,minmax(148px,1fr)); margin-top:26px}
.type{display:grid; grid-template-columns:38px 1fr; grid-template-rows:auto auto; gap:1px 12px;
  align-items:center; background:var(--surface); border:1px solid var(--line-soft);
  border-left:3px solid var(--t); border-radius:11px; padding:12px 14px}
.type img{grid-row:span 2; width:38px; height:38px}
.type b{font-family:var(--display); font-size:15px; font-weight:600; align-self:end}
.type span{font-size:11px; align-self:start; line-height:1.35}

/* -------------------------------------------------------------- ladder */
.ladder{padding:60px 0; border-bottom:1px solid var(--line-soft)}
.tiers{display:grid; gap:22px; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); margin-top:28px}
.tier{margin:0}
.tier img{display:block; width:100%; height:auto; border-radius:11px; box-shadow:var(--shadow)}
.tier figcaption{margin-top:12px; display:grid; grid-template-columns:auto 1fr; gap:2px 9px; align-items:baseline}
.tier .sym{grid-row:span 2; font-size:20px; color:var(--tier); line-height:1}
.tier b{font-family:var(--display); font-size:15px; font-weight:600}

/* -------------------------------------------------------------- binder */
.pack{padding:56px 0; border-bottom:1px solid var(--line-soft)}
.pack-head{display:flex; justify-content:space-between; align-items:flex-end; gap:24px; flex-wrap:wrap; margin-bottom:28px}
.pack-head h2{font-size:27px; display:flex; align-items:center; gap:12px}
.pack-head p{margin:6px 0 0; color:var(--ink-2); font-size:15px}
.pack-meta{color:var(--ink-3)}

.slots{display:grid; gap:26px; grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}
.slot{margin:0}
.sleeve{position:relative; border-radius:14px; overflow:hidden; background:var(--slot);
  box-shadow:var(--shadow); outline:1px solid var(--line-soft);
  transition:transform .28s cubic-bezier(.2,.8,.3,1), box-shadow .28s}
.sleeve img{display:block; width:100%; height:auto}
.slot-strip .sleeve{background:transparent; box-shadow:none; outline:none}
.slot-strip .sleeve img{width:auto; max-width:100%; max-height:420px; margin:0 auto; border-radius:8px; box-shadow:var(--shadow)}
.slot:hover .sleeve, .slot:focus-visible .sleeve{transform:translateY(-5px) scale(1.012);
  box-shadow:0 1px 2px rgba(0,0,0,.2), 0 26px 54px rgba(0,0,0,.28)}
.slot:focus-visible{outline:none}
.slot:focus-visible .sleeve{outline:2px solid var(--gold); outline-offset:3px}

/* Cursor-tracked prismatic sweep — the same material the cards imitate. */
.foil{position:absolute; inset:0; pointer-events:none; opacity:0; transition:opacity .3s;
  background:linear-gradient(calc(var(--fx,50) * 1.6deg - 40deg),
    hsla(190,95%,70%,.34) 0%, hsla(285,90%,72%,.28) 22%, hsla(330,92%,74%,.30) 42%,
    hsla(45,95%,70%,.30) 62%, hsla(140,85%,68%,.26) 82%, hsla(200,95%,72%,.32) 100%);
  mix-blend-mode:screen}
.slot:hover .foil{opacity:1}
@media (prefers-reduced-motion: reduce){
  .sleeve{transition:none} .foil{display:none} .slot:hover .sleeve{transform:none}
}
.slot-off .sleeve{filter:grayscale(.85) brightness(.72)}
figcaption{display:flex; flex-direction:column; gap:3px; margin-top:12px}
figcaption b{font-family:var(--display); font-size:16px; font-weight:600; letter-spacing:-.01em;
  display:flex; align-items:center; gap:7px}
.pip{width:16px; height:16px; flex:0 0 auto}

.tag{display:inline-block; font-family:var(--mono); font-size:10.5px; letter-spacing:.06em;
  padding:3px 8px; border-radius:5px; width:fit-content; margin-top:2px}
.tag-drop{background:color-mix(in oklab, var(--violet) 18%, transparent); color:var(--violet); text-transform:uppercase; margin-left:4px}
.tag-live{background:color-mix(in oklab, var(--violet) 15%, transparent); color:var(--violet)}
.tag-gone{background:var(--sunk); color:var(--ink-3)}

.two{display:grid; grid-template-columns:1.35fr .9fr; gap:52px; padding:60px 0; align-items:start}
@media (max-width:860px){ .two{grid-template-columns:1fr; gap:34px} }
.two h2{font-size:25px; margin-bottom:14px}
.two p{color:var(--ink-2); max-width:62ch}
.flow{list-style:none; padding:0; margin:22px 0 0; display:grid; gap:1px; background:var(--line-soft);
  border:1px solid var(--line-soft); border-radius:12px; overflow:hidden}
.flow li{background:var(--surface); padding:15px 18px; display:grid; grid-template-columns:112px 1fr; gap:18px; align-items:baseline}
.flow dt{font-family:var(--mono); font-size:11.5px; letter-spacing:.09em; text-transform:uppercase; color:var(--ink-3)}
.flow dd{margin:0; font-size:15px}
@media (max-width:520px){ .flow li{grid-template-columns:1fr; gap:4px} }
.strip-card{background:var(--surface); border:1px solid var(--line-soft); border-radius:16px; padding:22px;
  box-shadow:var(--shadow); text-align:center}
.strip-card img{width:min(200px,100%); height:auto; border-radius:8px; box-shadow:var(--shadow)}
.strip-card p{font-size:14px; color:var(--ink-2); margin:16px auto 0; max-width:34ch}

footer{padding:44px 0 70px; color:var(--ink-3); font-size:14px}
footer .wrap{display:flex; justify-content:space-between; gap:20px; flex-wrap:wrap; border-top:1px solid var(--line-soft); padding-top:26px}
</style>

<header class="top">
  <div class="wrap">
    <div class="eyebrow"><s></s> ${esc(SET.id)} · base set · ${frames.length} cards</div>
    <h1>Every Pal a customer can <em>pull</em> from the booth.</h1>
    <p class="lede">
      One creature-card set built for a photobooth: fourteen energy types,
      evolution lines, MAX cards, full arts and rainbow secrets numbered past
      the end of the set. Every card is rendered by the same engine that draws
      the picker on the touchscreen and the 300&nbsp;dpi master that goes to the
      printer, so nothing can look one way on screen and another in your hand.
    </p>
    <div class="stats">
      <div class="stat"><b>${SET.size}</b><span>in the set</span></div>
      <div class="stat"><b>${frames.filter(f => f.party || f.cutie).length}</b><span>personalised styles</span></div>
      <div class="stat"><b>${frames.filter(f => f.strip).length}</b><span>strip themes</span></div>
      <div class="stat"><b>${frames.length - SET.size}</b><span>secrets &amp; promos</span></div>
      <div class="stat"><b>${ENERGY_IDS.length}</b><span>energy types</span></div>
      <div class="stat"><b>5</b><span>rarity tiers</span></div>
      <div class="stat"><b>2.5&times;3.5&Prime;</b><span>card size</span></div>
    </div>
  </div>
</header>

<main>
  <div class="wrap">
    <section class="types-sec">
      <h2>Fourteen energy types</h2>
      <p style="color:var(--ink-2);max-width:62ch;margin:10px 0 0">
        A Pal's type decides its palette, its attack costs and where it sits in
        the weakness chart — which is why adding a creature is four lines of
        JSON, not a design job. Every symbol is drawn as a path, never a font
        character, so a card can't print a tofu box where its element should be.
      </p>
      <div class="types">${typeChart}</div>
    </section>

    <section class="ladder">
      <h2>The same card, five ways</h2>
      <p style="color:var(--ink-2);max-width:62ch;margin:10px 0 0">
        Rarity is rolled at capture time and printed into the card. Base odds
        below; a booster pack shifts weight up the ladder and guarantees at least
        one Rare. The foil is a printed simulation — pair it with holographic
        laminate film if you want cards that move in the light.
      </p>
      <div class="tiers">${ladder}</div>
    </section>
  </div>

  <div class="wrap">${packSections}</div>

  <div class="wrap">
    <section class="two">
      <div>
        <h2>What happens in one session</h2>
        <p>Payment is authorised before the shoot and captured only once the print
        job is accepted, so a jammed printer becomes a void rather than a refund
        request.</p>
        <ol class="flow">
          <li><dt>Pick</dt><dd>A Pal, a Party card, or a pastel Cutie card</dd></li>
          <li><dt>Personalise</dt><dd>Name, age and a buddy, typed on the touchscreen — party cards only</dd></li>
          <li><dt>Pay</dt><dd>Tap on a Stripe Terminal reader, or scan to pay by phone</dd></li>
          <li><dt>Shoot</dt><dd>Four frames off the camera's HDMI feed, plus a burst for the GIF</dd></li>
          <li><dt>Mint</dt><dd>Rarity rolled, serial assigned, card written to the season ledger</dd></li>
          <li><dt>Print</dt><dd>Card at 300&nbsp;dpi, optional 2&times;6 strip, QR for the digital copy</dd></li>
        </ol>
      </div>
      <div class="strip-card">
        <img src="${imgs.strip}" alt="Classic 2x6 photo strip" width="260" height="780" loading="lazy">
        <p>The classic 2&times;6 strip still prints alongside the card, from the same
        session's four shots.</p>
      </div>
    </section>
  </div>
</main>

<footer>
  <div class="wrap">
    <span>HoloBooth · set generated from <span class="mono">src/js/frames/packs.mjs</span></span>
    <span>Original creatures, original types, original frames</span>
  </div>
</footer>

<script>
// Tie the foil sweep to pointer position so it behaves like the material.
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  for (const slot of document.querySelectorAll('.slot')) {
    slot.addEventListener('pointermove', e => {
      const r = slot.getBoundingClientRect();
      slot.querySelector('.foil').style.setProperty('--fx', Math.round(((e.clientX - r.left) / r.width) * 100));
    });
  }
}
</script>`;

writeFileSync(join(root, 'out', 'gallery.html'), html);
console.log(`gallery.html written — ${(html.length / 1024 / 1024).toFixed(2)} MB, ${frames.length} cards`);
