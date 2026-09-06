/**
 * app.js — the kiosk state machine.
 *
 *   attract → pick frame → pick product → pay → capture → reveal → thanks
 *
 * Two rules shape everything here:
 *  1. Never take money you can't deliver on. Payment is authorised before the
 *     shoot and captured only after the print job is accepted, so a jammed
 *     printer becomes a void, not a refund request.
 *  2. Never strand a customer. Every screen has a timeout back to attract, and
 *     every failure path still hands them their digital copy.
 */

import { pickerGroups, allFrames, frameById, frameAspect, frameBox, RARITIES, RARITY_ORDER, SET, energy } from './frames/packs.mjs';
import { rarityOdds } from './frames/rarity.mjs';
import { COMPANIONS, companionById, companionCanvas } from './frames/companions.mjs';
import { loadPack, packFrames } from './frames/assetpack.mjs';
import { stickerCatalog, stickerCanvas, newPlacement, stickerAt, DECOS } from './frames/stickers.mjs';
import { renderCard, renderStrip, mintCard, printSize } from './frames/render.mjs';
import { Camera } from './camera.js';
import { createPaymentProvider } from './payments.js';
import { encodeGif } from './gif.js';

import { installBridge, PLATFORMS } from './bridge.js';

/* --------------------------------------------------------------- state */

const S = {
  cfg: null,
  screen: 'attract',
  frameId: null,
  product: null,
  payment: null,
  shots: [],          // full-res captured canvases
  burst: [],
  heroIndex: 0,
  card: null,
  cardCanvas: null,
  stripCanvas: null,
  gifBlob: null,
  downloadUrl: null,
  retakes: 0,
  camera: null,
  pay: null,
  idleTimer: null,
  adminTaps: 0,
  platform: null,
  personal: { name: '', age: '', companionId: null },
  companionImg: null,
  packFrames: [],
  packGroups: [],
  stickers: [],
  stickerImgs: {},
  artWindow: null,
  previewCard: null,
};

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const money = cents => `$${(cents / 100).toFixed(2)}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const formatPct = pct => (pct > 0 && pct < 1 ? pct.toFixed(1) : Math.round(pct)) + '%';
const isToughRarity = id => RARITY_ORDER.indexOf(id) >= RARITY_ORDER.indexOf('rare');

/** Odds markup shared by the product screen and the reveal's tap-to-open cover. */
function oddsBreakdownHtml(odds) {
  return odds.map(o => `
    <span class="odds-pill${isToughRarity(o.rarity) ? ' tough' : ''}" style="--c:${o.rarityColor}">
      <i></i>${o.rarityLabel} <b>${formatPct(o.pct)}</b>
    </span>`).join('');
}

/* ------------------------------------------------------ name generator */

/**
 * "Surprise me" is a local, offline generator — no network call, no API key,
 * so it works identically at a venue with no signal as it does anywhere
 * else, and never adds latency or a point of failure to the kiosk flow.
 * Every prefix/suffix pair is kept to 14 characters or under (the tightest
 * of the two name fields' own limits), so a generated name is guaranteed to
 * fit without truncating wherever it lands.
 */
const NAME_GEN_PREFIX = ['Blaze', 'Nova', 'Echo', 'Storm', 'Frost', 'Comet', 'Ember', 'Rogue', 'Turbo', 'Lucky', 'Cosmic', 'Wild', 'Neon', 'Ghost', 'Shadow', 'Golden', 'Mystic', 'Silver'];
const NAME_GEN_SUFFIX = ['Fox', 'Wolf', 'Spark', 'Nova', 'Comet', 'Blaze', 'Storm', 'Star', 'Fang', 'Flare', 'Wisp', 'Shade', 'Bolt', 'Ranger', 'Drift', 'Ghost', 'Phoenix', 'Tiger', 'Falcon', 'Glow'];

function generateCharacterName() {
  const prefix = NAME_GEN_PREFIX[Math.floor(Math.random() * NAME_GEN_PREFIX.length)];
  let suffix;
  do { suffix = NAME_GEN_SUFFIX[Math.floor(Math.random() * NAME_GEN_SUFFIX.length)]; }
  while (suffix === prefix);
  return `${prefix} ${suffix}`;
}

/* ---------------------------------------------------------- navigation */

function go(name) {
  S.screen = name;
  $$('.screen').forEach(el => (el.hidden = el.dataset.screen !== name));
  resetIdle();
  ON_ENTER[name]?.();
}

function resetIdle() {
  clearTimeout(S.idleTimer);
  const ms = S.screen === 'attract' ? null
    : ['capture', 'pay'].includes(S.screen) ? S.cfg.booth.sessionTimeoutMs
    : S.cfg.booth.idleAttractAfterMs;
  if (ms) S.idleTimer = setTimeout(() => { abandon(); }, ms);
}

function abandon() {
  S.camera?.stop();
  S.pay?.cancel();
  go('attract');
}

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 4200);
}

/* ------------------------------------------------------------ bootstrap */

async function boot() {
  S.platform = await installBridge();
  document.body.dataset.platform = S.platform;
  S.cfg = await window.booth.config.get();

  // Physical buttons (Pi only): an arcade shutter button drives the same flow
  // as a screen tap, so the booth works with the lid closed.
  window.booth.input?.subscribe(ev => {
    resetIdle();
    if (ev.action === 'start' && S.screen === 'attract') go('pick');
    else if (ev.action === 'shutter' && S.screen === 'reveal') {
      const cover = $('#pack-cover');
      if (!cover.hidden) cover.click(); else doPrint();
    }
    else if (ev.action === 'cancel') abandon();
  });
  document.addEventListener('pointerdown', resetIdle);

  $$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  $('#to-product').addEventListener('click', () => {
    // Party cards need a name before they mean anything; everything else can
    // go straight to the till.
    const tpl = lookupFrame(S.frameId)?.template;
    go(['party', 'kawaii', 'assetPack'].includes(tpl) ? 'personalize' : 'product');
  });
  $('#pz-done').addEventListener('click', () => go('product'));
  $('#pay-cancel').addEventListener('click', () => { S.pay?.cancel(); go('product'); });
  $('#btn-print').addEventListener('click', doPrint);
  $('#btn-retake').addEventListener('click', retake);
  $('#btn-done').addEventListener('click', () => go('thanks'));

  // Operator panel: repeated taps in the bottom-left corner.
  $('#admin-tap').addEventListener('click', () => {
    if (++S.adminTaps >= (S.cfg.admin?.secretTapCount || 5)) { S.adminTaps = 0; go('admin'); }
    setTimeout(() => (S.adminTaps = 0), 2500);
  });

  // Dev conveniences, harmless in production (nobody has a keyboard at a kiosk).
  window.addEventListener('keydown', e => {
    if (e.key === 'd') window.__forceDecline = true;
    if (e.key === 'Escape') abandon();
    if (e.key === '`') document.body.classList.toggle('debug');
  });

  await loadAssetPacks();
  buildPicker();
  go('attract');
}

/* ------------------------------------------------------------- attract */

const ON_ENTER = {};

ON_ENTER.attract = async () => {
  S.shots = []; S.burst = []; S.card = null; S.retakes = 0;
  S.gifBlob = null; S.downloadUrl = null; S.payment = null;
  S.personal = { name: '', age: '', companionId: null };
  S.companionImg = null;
  S.stickers = [];
  S.artWindow = null;
  S.previewCard = null;
  S.camera?.stop();

  const live = pickerGroups();
  const count = live.reduce((n, g) => n + g.frames.length, 0);
  $('#attract-headline').textContent = S.cfg.attract?.headline || 'PICK YOUR CARD.';
  $('#attract-sub').textContent = (S.cfg.attract?.sub || '').replace('{{count}}', count);

  // Limited drop banner with a live countdown — scarcity is the whole hook.
  const drop = allFrames().find(f => f.availability?.end && new Date(f.availability.end) > new Date()
    && new Date(f.availability.start) <= new Date());
  const strip = $('#drop-strip');
  if (drop && S.cfg.attract?.showDropTimer) {
    const days = Math.ceil((new Date(drop.availability.end) - Date.now()) / 864e5);
    $('#drop-text').textContent = `${drop.name} — limited, ${days} day${days === 1 ? '' : 's'} left`;
    strip.hidden = false;
  } else strip.hidden = true;

  if (S.cfg.attract?.showRecentPulls) {
    const stats = await window.booth.cards.stats({ seasonId: S.cfg.collection.seasonId });
    $('#recent-pulls').innerHTML = (stats.recent || []).slice(0, 6)
      .map(c => `<span class="chip">${c.raritySymbol} ${frameById(c.frameId)?.name || c.frameId} · ${frameById(c.frameId)?.collectorNumber || ''}</span>`)
      .join('');
  }
};


/* ------------------------------------------------------------ asset packs */

/**
 * Licensed artwork lives in packs/, not in the code. Each pack is a folder of
 * images somebody supplied plus a manifest saying where the photo and the text
 * go; the booth composites into it. See packs/README.md.
 *
 * A pack that fails to load must never take the booth down mid-event — the
 * drawn frames still work, and the operator panel reports what happened.
 */
async function loadAssetPacks() {
  const cfg = S.cfg.assetPacks;
  S.packFrames = [];
  S.packGroups = [];
  S.packErrors = [];
  if (!cfg?.enabled || !Array.isArray(cfg.load) || !cfg.load.length) return;

  for (const id of cfg.load) {
    const base = `../${cfg.dir || 'packs'}/${id}`;
    try {
      const loaded = await loadPack(base, {
        readJson: async url => {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`${r.status} fetching ${url}`);
          return r.json();
        },
        readImage: url => new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = () => rej(new Error(`could not load ${url}`));
          img.src = url;
        }),
      });

      // Licensed fonts ship with the pack; register them before anything draws.
      for (const f of loaded.manifest.fonts || []) {
        try {
          const face = new FontFace(f.family, `url(${base}/${f.file})`, { weight: String(f.weight || 400) });
          await face.load();
          document.fonts.add(face);
        } catch (e) { console.warn(`[pack:${id}] font ${f.family} failed:`, e.message); }
      }

      const frames = packFrames(loaded);
      S.packFrames.push(...frames);
      S.packGroups.push({
        id: `assetpack:${loaded.manifest.id}`,
        name: loaded.manifest.name,
        tagline: loaded.manifest.licensor?.name
          ? `Licensed artwork · ${loaded.manifest.licensor.name}`
          : 'Supplied artwork',
        licensed: true,
        frames,
      });
      console.info(`[pack:${id}] ${frames.length} frames loaded`);
    } catch (e) {
      console.error(`[pack:${id}] ${e.message}`);
      S.packErrors.push({ id, message: e.message });
    }
  }
}

/** Frames can come from the built-in catalogue or from a loaded pack. */
function lookupFrame(id) {
  return S.packFrames.find(f => f.id === id) || frameById(id);
}


/* --------------------------------------------------------- style groups */

/**
 * Every group the picker may show, filtered and ordered by `picker.show` in
 * booth.config.json. Hiding a group never deletes it — the frames stay in the
 * catalogue, so re-enabling one is a config edit, not a rebuild.
 */
function visibleGroups() {
  const all = [...pickerGroups(), ...S.packGroups];
  const want = S.cfg.picker?.show;
  if (!Array.isArray(want) || !want.length) return all;
  return want.map(id => all.find(g => g.id === id)).filter(Boolean);
}

/** Cards are 2.5x3.5, strips are 2x6 — nothing may assume the card. */
function boxFor(frame, width) {
  return frameBox(frame, width);
}

function isStrip(frame) {
  return frame?.template === 'strip';
}

/** Strips need every shot; cards need the chosen one. */
function photoArgs(frame) {
  return isStrip(frame)
    ? { photos: S.shots.length ? S.shots : [placeholderPhoto()], photo: null }
    : { photo: S.shots[S.heroIndex] || placeholderPhoto(), photos: [] };
}

/* -------------------------------------------------------------- picker */

let pickerBuilt = false;

function buildPicker() {
  if (pickerBuilt) return;
  pickerBuilt = true;

  const groups = visibleGroups();
  $('#season-label').textContent = `${SET.name} · ${SET.total} cards`;

  // Promos stay first in the tab order — scarcity should be visible — but the
  // picker opens on the first substantial pack, because landing on a tab with
  // one card in it reads as a broken screen.
  const landing = groups.find(g => !g.limited && g.frames.length >= 3) || groups[0];

  $('#pack-tabs').innerHTML = groups
    .map(g => `<button class="tab ${g === landing ? 'on' : ''}" data-pack="${g.id}">${g.name}${g.limited ? '<span class="dot">●</span>' : ''}${g.licensed ? '<span class="dot lic">◆</span>' : ''}</button>`)
    .join('');

  $$('#pack-tabs .tab').forEach(t => t.addEventListener('click', () => {
    $$('#pack-tabs .tab').forEach(x => x.classList.toggle('on', x === t));
    renderGrid(t.dataset.pack);
  }));

  renderGrid(landing?.id);
}

function renderGrid(packId) {
  const group = visibleGroups().find(g => g.id === packId);
  if (!group) return;
  const grid = $('#frame-grid');
  grid.innerHTML = '';

  for (const f of group.frames) {
    const tile = document.createElement('div');
    tile.className = 'frame-tile' + (isStrip(f) ? ' tall' : '');
    tile.dataset.frame = f.id;
    const cv = document.createElement('canvas');
    const box = boxFor(f, 360);
    cv.width = box.W; cv.height = box.H;
    tile.append(cv);
    const e = energy(f.energyType);
    tile.insertAdjacentHTML('beforeend', `
      <div class="nm"><i class="type-dot" style="background:${e.base}"></i>${f.name}</div>
      <div class="mt">
        <span class="num">${f.collectorNumber}</span>
        ${f.availability?.mintLimit
          ? `<span class="badge-limited">${f.availability.mintLimit} only</span>`
          : `<span>${e.name} · ${f.hp} HP</span>`}
      </div>`);
    grid.append(tile);

    // Thumbnails render through the same engine as the print master — so a
    // frame can never look one way in the picker and another on the card.
    renderCard(cv.getContext('2d'), {
      frame: f, frameId: f.id, W: box.W, H: box.H,
      photo: placeholderPhoto(),
      photos: isStrip(f) ? [placeholderPhoto(), placeholderPhoto(), placeholderPhoto(), placeholderPhoto()] : [],
      character: f.character ? placeholderCharacter() : null,
      companion: (f.template === 'party' || f.template === 'kawaii') ? companionThumb(f.energyType) : null,
      card: mintCard({ frame: f, frameId: f.id, seasonId: S.cfg.collection.seasonId, mint: 1, forcedRarity: f.rarityFloor || 'rare' }),
      stock: S.cfg.cards?.stock || null,
      // Every template now prints whatever name it's given (falling back to
      // "Friend" only when nothing was typed), so the browsing preview shows
      // an obvious placeholder rather than that generic fallback.
      personalization: { name: 'Name', age: 7 },
      foil: true,
    });

    tile.addEventListener('click', () => {
      $$('.frame-tile').forEach(x => x.classList.toggle('on', x === tile));
      S.frameId = f.id;
      $('#picked-label').textContent = isStrip(f)
        ? `${f.name} — photo strip`
        : `${f.name} — ${f.collectorNumber} · ${energy(f.energyType).name}`;
      $('#to-product').disabled = false;
    });
  }
}

const _buddyThumbs = new Map();
/** A cached buddy canvas for picker thumbnails, matched to the card's colour. */
function companionThumb(type) {
  if (_buddyThumbs.has(type)) return _buddyThumbs.get(type);
  const spec = COMPANIONS.find(c => c.type === type) || COMPANIONS[0];
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  c.getContext('2d').drawImage(companionCanvas(spec, 256, makeCanvasStatic), 0, 0);
  _buddyThumbs.set(type, c);
  return c;
}
function makeCanvasStatic(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

let _ph = null;
function placeholderPhoto() {
  if (_ph) return _ph;
  const c = document.createElement('canvas');
  c.width = 600; c.height = 600;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 600, 600);
  g.addColorStop(0, '#4b5a7a'); g.addColorStop(1, '#2a3145');
  x.fillStyle = g; x.fillRect(0, 0, 600, 600);
  x.fillStyle = 'rgba(255,255,255,.16)';
  x.beginPath(); x.arc(300, 250, 90, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.ellipse(300, 520, 175, 165, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(255,255,255,.5)';
  x.font = '600 30px Nunito, sans-serif'; x.textAlign = 'center';
  x.fillText('YOUR PHOTO', 300, 585);
  _ph = c;
  return c;
}

let _pc = null;
function placeholderCharacter() {
  if (_pc) return _pc;
  const c = document.createElement('canvas');
  c.width = 400; c.height = 400;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(255,255,255,.9)'; x.strokeStyle = '#2b2233'; x.lineWidth = 14;
  x.beginPath(); x.ellipse(200, 230, 130, 140, 0, 0, Math.PI * 2); x.fill(); x.stroke();
  [-1, 1].forEach(d => { x.beginPath(); x.ellipse(200 + d * 82, 118, 36, 54, d * .4, 0, Math.PI * 2); x.fill(); x.stroke(); });
  x.fillStyle = '#2b2233';
  [-1, 1].forEach(d => { x.beginPath(); x.arc(200 + d * 42, 212, 11, 0, Math.PI * 2); x.fill(); });
  _pc = c;
  return c;
}


/* --------------------------------------------------------- personalize */

const KB_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
let pzBuilt = false;

ON_ENTER.personalize = () => {
  if (!pzBuilt) buildPersonalizeUI();
  // Default the buddy to one matching the chosen card's colour, so the card
  // already looks finished before they touch anything.
  if (!S.personal.companionId) {
    const type = lookupFrame(S.frameId)?.energyType;
    S.personal.companionId = (COMPANIONS.find(c => c.type === type) || COMPANIONS[0]).id;
    syncBuddySelection();
  }
  refreshPersonalize();
};

function buildPersonalizeUI() {
  pzBuilt = true;

  buildKeyboard($('#kb'), {
    max: 14,
    get: () => S.personal.name,
    set: v => { S.personal.name = v; },
    onChange: refreshPersonalize,
  });

  $('#pz-gen-name').addEventListener('click', () => {
    S.personal.name = generateCharacterName();
    refreshPersonalize();
  });

  const pad = $('#pad');
  pad.innerHTML = [1,2,3,4,5,6,7,8,9,0].map(n => `<button class="key" data-n="${n}">${n}</button>`).join('')
    + `<button class="key key-wide" data-n="DEL" style="grid-column: span 5">delete age</button>`;
  pad.addEventListener('click', e => {
    const n = e.target.closest('.key')?.dataset.n;
    if (!n) return;
    if (n === 'DEL') S.personal.age = String(S.personal.age).slice(0, -1);
    else if (String(S.personal.age).length < 3) S.personal.age = String(S.personal.age) + n;
    refreshPersonalize();
  });

  const grid = $('#buddies');
  grid.innerHTML = COMPANIONS.map(c =>
    `<div class="buddy" data-buddy="${c.id}"><canvas width="120" height="120"></canvas><span>${c.name}</span></div>`
  ).join('');
  COMPANIONS.forEach(c => {
    const cv = grid.querySelector(`[data-buddy="${c.id}"] canvas`);
    cv.getContext('2d').drawImage(companionCanvas(c, 120, makeCanvas), 0, 0);
  });
  grid.addEventListener('click', e => {
    const id = e.target.closest('.buddy')?.dataset.buddy;
    if (!id) return;
    S.personal.companionId = id;
    S.companionImg = null;
    syncBuddySelection();
    refreshPersonalize();
  });
}

function syncBuddySelection() {
  $$('#buddies .buddy').forEach(b =>
    b.classList.toggle('on', b.dataset.buddy === S.personal.companionId));
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Companion art as an Image, cached — the card renderer needs a drawable. */
async function companionImage() {
  if (S.companionImg) return S.companionImg;
  const spec = companionById(S.personal.companionId);
  if (!spec) return null;
  S.companionImg = await canvasToImage(companionCanvas(spec, 512, makeCanvas));
  return S.companionImg;
}

let pzTimer = null;
function refreshPersonalize() {
  const nameEl = $('#fld-name'), ageEl = $('#fld-age');
  nameEl.textContent = S.personal.name || '';
  nameEl.classList.toggle('is-empty', !S.personal.name);
  ageEl.textContent = S.personal.age || '';
  ageEl.classList.toggle('is-empty', !S.personal.age);

  const ready = S.personal.name.trim().length >= 1;
  $('#pz-done').disabled = !ready;
  $('#pz-summary').textContent = ready
    ? `${S.personal.name.trim()}${S.personal.age ? `, ${S.personal.age}` : ''} · ${companionById(S.personal.companionId)?.name || ''}`
    : 'Type a name to start';

  // Live preview, debounced — every keypress would otherwise redraw a card.
  clearTimeout(pzTimer);
  pzTimer = setTimeout(drawPersonalizePreview, 90);
}

async function drawPersonalizePreview() {
  const cv = $('#pz-canvas');
  const pf = lookupFrame(S.frameId);
  renderCard(cv.getContext('2d'), {
    frame: pf, frameId: S.frameId, W: cv.width, H: cv.height,
    photo: placeholderPhoto(),
    companion: await companionImage(),
    card: mintCard({
      frame: pf, frameId: S.frameId, seasonId: S.cfg.collection.seasonId, mint: 1, forcedRarity: 'rare',
    }),
    personalization: personalizationPayload(),
    approvalMode: !!S.cfg.assetPacks?.approvalMode,
  });
}

/** What the renderer needs, from what the customer typed. */
function personalizationPayload() {
  return {
    name: S.personal.name.trim(),
    age: S.personal.age === '' ? null : Number(S.personal.age),
    companionId: S.personal.companionId,
  };
}

/* ------------------------------------------------------------- product */

ON_ENTER.product = () => {
  const frame = lookupFrame(S.frameId);
  $('#products').innerHTML = S.cfg.pricing.products.map(p => {
    const odds = rarityOdds({
      boost: p.rarityBoost || 1,
      floor: frame?.rarityFloor || null,
      guarantee: p.guaranteeAtLeast || null,
    });
    const toughPct = odds.filter(o => isToughRarity(o.rarity)).reduce((a, o) => a + o.pct, 0);
    return `
    <div class="product ${p.featured ? 'featured' : ''}" data-product="${p.id}">
      ${p.featured ? '<span class="tag">MOST POPULAR</span>' : ''}
      <h3>${p.name}</h3>
      <div class="blurb">${p.blurb}</div>
      <div class="price">${money(p.amount)}</div>
      ${p.guaranteeAtLeast ? `<div class="odds">Guaranteed ${RARITIES[p.guaranteeAtLeast].label} or better</div>`
        : p.rarityBoost > 1 ? `<div class="odds">${Math.round((p.rarityBoost - 1) * 100)}% better pull odds</div>` : ''}
      <div class="odds-breakdown">${oddsBreakdownHtml(odds)}</div>
      <div class="odds-tough">Rare or better: ${formatPct(toughPct)}</div>
    </div>`;
  }).join('');

  $$('.product').forEach(el => el.addEventListener('click', () => {
    S.product = S.cfg.pricing.products.find(p => p.id === el.dataset.product);
    go('pay');
  }));

  if (frame) $('[data-screen="product"] h2').textContent = `${frame.name} — what do you want?`;
};

/* ----------------------------------------------------------------- pay */

ON_ENTER.pay = async () => {
  $('#pay-amount').textContent = money(S.product.amount);
  $('#pay-product').textContent = S.product.name;
  $('#pay-qr').hidden = true;
  const status = $('#pay-status');
  status.classList.remove('err');

  S.pay = createPaymentProvider(
    { ...S.cfg.payments, currency: S.cfg.booth.currency },
    {
      onStatus: s => {
        status.textContent = s.message || '';
        if (s.qrUrl) {
          $('#pay-qr').src = `${S.cfg.payments.serverUrl}/qr?url=${encodeURIComponent(s.qrUrl)}`;
          $('#pay-qr').hidden = false;
        }
      },
    }
  );

  try {
    await S.pay.init();
  } catch (e) {
    status.textContent = e.message;
    status.classList.add('err');
    return;
  }

  const res = await S.pay.collect(S.product, {
    frameId: S.frameId, boothId: S.cfg.booth.id, season: S.cfg.collection.seasonId,
  });

  if (!res.ok) {
    if (res.error === 'cancelled') return;
    status.textContent = res.error;
    status.classList.add('err');
    await sleep(2600);
    go('product');
    return;
  }

  S.payment = res;
  await window.booth.sales.record({
    at: new Date().toISOString(), amount: res.amount, productId: S.product.id,
    frameId: S.frameId, paymentId: res.paymentId, method: res.method,
    brand: res.brand, last4: res.last4, boothId: S.cfg.booth.id,
  });
  go('capture');
};

/* ------------------------------------------------------------- capture */

ON_ENTER.capture = async () => {
  const cam = (S.camera ||= new Camera(S.cfg.camera));
  cam.onStatus = s => {
    $('#cam-status').textContent = s.message;
    if (s.level === 'error') toast(s.message, true);
  };

  try {
    await cam.start($('#preview'));
  } catch (e) {
    toast(`Camera problem: ${e.message}`, true);
    // Paid but can't shoot — do not strand them. Refund path is in the
    // operator panel; get them off the screen with an explanation.
    await sleep(2500);
    go('thanks');
    $('#thanks-sub').textContent = 'Sorry — the camera dropped out. Find the operator for a refund.';
    return;
  }

  await runShootSequence();
};

async function runShootSequence() {
  const c = S.cfg.capture;
  const n = c.shotsPerSession;
  S.shots = [];
  $('#shot-pips').innerHTML = Array.from({ length: n }, () => '<i></i>').join('');

  for (let i = 0; i < n; i++) {
    await countdown(c.countdownSeconds, i === 0 ? 'GET READY' : null);
    if (c.flashScreen) { $('#flash').classList.add('go'); setTimeout(() => $('#flash').classList.remove('go'), 350); }

    S.shots.push(S.camera.grab({ mirror: false }));
    $$('#shot-pips i')[i]?.classList.add('on');

    // Burst on the last shot only — keeps the session short.
    if (i === n - 1 && c.burst?.enabled && S.product.gif) {
      $('#countdown').textContent = 'HOLD IT';
      S.burst = await S.camera.burst(c.burst);
    }
    if (i < n - 1) await sleep(c.gapBetweenShotsMs);
  }

  $('#countdown').textContent = '';
  S.camera.stop();
  go('decorate');
}

function countdown(seconds, prefix) {
  return new Promise(resolve => {
    const el = $('#countdown');
    let t = seconds;
    if (prefix) { el.textContent = prefix; }
    const tick = () => {
      el.textContent = t > 0 ? String(t) : '';
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      if (t-- <= 0) { clearInterval(iv); resolve(); }
    };
    const iv = setInterval(tick, 1000);
    setTimeout(tick, prefix ? 700 : 0);
  });
}


/* ---------------------------------------------------------- decorate */

/**
 * Between the shoot and the reveal: pick which shot goes on the card, stick
 * things on it, and change or gamble on the frame.
 *
 * Sticker positions are stored as fractions of the photo window, so what they
 * arrange on a 380px preview lands identically on the 750x1050 print master.
 */

let decBuilt = false;
let decRaf = null;

ON_ENTER.decorate = () => {
  if (!decBuilt) buildDecorateUI();
  buildShotGrid();
  buildSwatches();
  // Only roll a fresh pull when this is actually a new card (first visit, or
  // the customer picked a different frame). Re-entering decorate — say, after
  // a retake — must not silently reroll a rarity the customer already saw.
  if (!S.previewCard || S.previewCard.frameId !== S.frameId) {
    S.previewCard = mintCard({
      frame: lookupFrame(S.frameId), frameId: S.frameId,
      seasonId: S.cfg.collection.seasonId, mint: 1,
      product: S.product,
    });
  }
  drawDecorate();
};

function buildDecorateUI() {
  decBuilt = true;

  $$('#dec-tabs .tab').forEach(t => t.addEventListener('click', () => {
    $$('#dec-tabs .tab').forEach(x => x.classList.toggle('on', x === t));
    $$('.dec-pane').forEach(p => (p.hidden = p.dataset.dpane !== t.dataset.dtab));
  }));

  const cat = stickerCatalog();
  const fill = (host, items) => {
    host.innerHTML = items.map(s => `<div class="sticker" data-sticker="${s.id}"><canvas width="96" height="96"></canvas></div>`).join('');
    items.forEach(s => {
      const cv = host.querySelector(`[data-sticker="${s.id}"] canvas`);
      cv.getContext('2d').drawImage(stickerImage(s.id, 96), 0, 0);
    });
  };
  fill($('#sticker-buddies'), cat.filter(s => s.kind === 'buddy'));
  fill($('#sticker-decos'), cat.filter(s => s.kind === 'deco'));

  $('.dec-panel').addEventListener('click', e => {
    const add = e.target.closest('.sticker')?.dataset.sticker;
    if (add) {
      if (S.stickers.length >= 12) { toast('That is plenty of stickers.'); return; }
      S.stickers.push(newPlacement(add, S.stickers.length));
      syncTray(); drawDecorate();
      return;
    }
    const kill = e.target.closest('.placed')?.dataset.key;
    if (kill) {
      S.stickers = S.stickers.filter(x => x.key !== kill);
      syncTray(); drawDecorate();
    }
  });

  $('#dec-clear').addEventListener('click', () => {
    S.stickers = []; syncTray(); drawDecorate();
  });

  $('#dec-done').addEventListener('click', async () => {
    $('#dec-done').disabled = true;
    await buildOutputs();
    $('#dec-done').disabled = false;
    go('reveal');
  });

  const refreshDecName = () => {
    const el = $('#dec-name');
    el.textContent = S.personal.name || '';
    el.classList.toggle('is-empty', !S.personal.name);
    buildSwatches();
    drawDecorate();
  };

  buildKeyboard($('#dec-kb'), {
    max: 18,
    get: () => S.personal.name,
    set: v => { S.personal.name = v; },
    onChange: refreshDecName,
  });

  $('#dec-gen-name').addEventListener('click', () => {
    S.personal.name = generateCharacterName();
    refreshDecName();
  });

  attachStickerGestures($('#dec-canvas'));
}

/**
 * A touchscreen has no keyboard, so every text field needs one on screen.
 * Shared by the personalise screen and the card-name tab.
 */
function buildKeyboard(host, { max = 14, get, set, onChange }) {
  host.innerHTML = KB_ROWS.map(row =>
    `<div class="kb-row">${[...row].map(k => `<button class="key" data-k="${k}">${k}</button>`).join('')}</div>`
  ).join('') + `<div class="kb-row">
      <button class="key key-wide" data-k="SPACE">space</button>
      <button class="key key-wide" data-k="DEL">delete</button>
    </div>`;

  host.addEventListener('click', e => {
    const k = e.target.closest('.key')?.dataset.k;
    if (!k) return;
    let v = get();
    if (k === 'DEL') v = v.slice(0, -1);
    else if (k === 'SPACE') { if (v.length < max) v += ' '; }
    else if (v.length < max) {
      // Title case as they type — nobody wants CAPS on a keepsake.
      v += (v.length === 0 || v.endsWith(' ')) ? k : k.toLowerCase();
    }
    set(v);
    onChange();
  });
}

/* ---- shots */

function buildShotGrid() {
  const grid = $('#shot-grid');
  grid.innerHTML = S.shots.map((_, i) =>
    `<div class="shot ${i === S.heroIndex ? 'on' : ''}" data-shot="${i}"><i>${i + 1}</i><canvas width="220" height="124"></canvas></div>`).join('');
  S.shots.forEach((shot, i) => {
    const cv = grid.querySelector(`[data-shot="${i}"] canvas`);
    cv.getContext('2d').drawImage(shot, 0, 0, cv.width, cv.height);
  });
  grid.onclick = e => {
    const idx = e.target.closest('.shot')?.dataset.shot;
    if (idx == null) return;
    S.heroIndex = Number(idx);
    $$('#shot-grid .shot').forEach(el => el.classList.toggle('on', el.dataset.shot === idx));
    drawDecorate();
  };
}

/* ---- frame swatches, plus the mystery pull */

function buildSwatches() {
  const group = visibleGroups().find(g => g.frames.some(f => f.id === S.frameId));
  const frames = group ? group.frames : [];
  const host = $('#frame-swatches');

  host.innerHTML = frames.map(f => {
    const b = boxFor(f, 120);
    return `<div class="swatch ${f.id === S.frameId ? 'on' : ''}${isStrip(f) ? ' tall' : ''}" data-swatch="${f.id}"><canvas width="${b.W}" height="${b.H}"></canvas></div>`;
  }).join('') + '<div class="swatch mystery" data-swatch="__mystery">?</div>';

  frames.forEach(f => {
    const cv = host.querySelector(`[data-swatch="${f.id}"] canvas`);
    renderCard(cv.getContext('2d'), {
      frame: f, frameId: f.id, W: cv.width, H: cv.height,
      ...photoArgs(f),
      companion: ['party', 'kawaii'].includes(f.template) ? companionThumb(f.energyType) : null,
      personalization: personalizationPayload(),
      card: mintCard({ frame: f, frameId: f.id, mint: 1, forcedRarity: f.rarityFloor || 'rare' }),
      stock: S.cfg.cards?.stock || null,
    });
  });

  host.onclick = e => {
    const pick = e.target.closest('.swatch')?.dataset.swatch;
    if (!pick) return;
    if (pick === '__mystery') { startFrameReveal(frames); return; }
    S.frameId = pick;
    $$('#frame-swatches .swatch').forEach(el => el.classList.toggle('on', el.dataset.swatch === pick));
    S.previewCard = mintCard({
      frame: lookupFrame(S.frameId), frameId: S.frameId,
      seasonId: S.cfg.collection.seasonId, mint: 1, product: S.product,
    });
    drawDecorate();
  };
}

/* ---- sticker images, cached */

function stickerImage(id, size = 384) {
  const key = `${id}@${size}`;
  if (!S.stickerImgs[key]) S.stickerImgs[key] = stickerCanvas(id, size, makeCanvas);
  return S.stickerImgs[key];
}

function stickerImageMap() {
  const map = {};
  for (const s of S.stickers) map[s.id] = stickerImage(s.id, 384);
  return map;
}

function syncTray() {
  const tray = $('#placed-tray');
  tray.innerHTML = S.stickers.map(s =>
    `<div class="placed" data-key="${s.key}"><canvas width="46" height="46"></canvas></div>`).join('');
  S.stickers.forEach(s => {
    const cv = tray.querySelector(`[data-key="${s.key}"] canvas`);
    cv.getContext('2d').drawImage(stickerImage(s.id, 96), 0, 0, 46, 46);
  });
}

/* ---- preview */

function drawDecorate() {
  const cv = $('#dec-canvas');
  const f = lookupFrame(S.frameId);
  const box = boxFor(f, 500);
  if (cv.width !== box.W || cv.height !== box.H) { cv.width = box.W; cv.height = box.H; }
  const meta = renderCard(cv.getContext('2d'), {
    frame: f, frameId: S.frameId, W: cv.width, H: cv.height,
    ...photoArgs(f),
    companion: ['party', 'kawaii'].includes(f.template) ? companionThumb(f.energyType) : null,
    personalization: personalizationPayload(),
    card: S.previewCard,
    stock: S.cfg.cards?.stock || null,
    stickers: S.stickers,
    stickerImages: stickerImageMap(),
    approvalMode: !!S.cfg.assetPacks?.approvalMode,
  });
  S.artWindow = meta.artWindow || null;
}

function scheduleDecorateDraw() {
  if (decRaf) return;
  decRaf = requestAnimationFrame(() => { decRaf = null; drawDecorate(); });
}

/* ---- drag / pinch / twist */

function attachStickerGestures(canvas) {
  const pointers = new Map();
  let active = null;
  let start = null;

  const toFraction = e => {
    const r = canvas.getBoundingClientRect();
    const cx = (e.clientX - r.left) * (canvas.width / r.width);
    const cy = (e.clientY - r.top) * (canvas.height / r.height);
    const w = S.artWindow;
    if (!w) return null;
    return { fx: (cx - w.x) / w.w, fy: (cy - w.y) / w.h };
  };

  const twoFingerState = () => {
    const [a, b] = [...pointers.values()];
    return {
      dist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
      angle: Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX),
    };
  };

  canvas.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, e);
    canvas.setPointerCapture(e.pointerId);
    const p = toFraction(e);
    if (!p) return;

    if (pointers.size === 1) {
      const hit = stickerAt(S.stickers, p.fx, p.fy, S.artWindow);
      active = hit;
      if (hit) {
        // Bring the grabbed sticker to the front — it is the one being worked on.
        S.stickers = S.stickers.filter(x => x !== hit).concat(hit);
        start = { grabX: p.fx - hit.x, grabY: p.fy - hit.y };
        scheduleDecorateDraw();
      }
    } else if (pointers.size === 2 && active) {
      const t = twoFingerState();
      start = { ...start, dist: t.dist, angle: t.angle, scale: active.scale, rot: active.rot };
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, e);
    if (!active) return;

    if (pointers.size >= 2 && start?.dist) {
      const t = twoFingerState();
      active.scale = Math.max(0.08, Math.min(0.9, start.scale * (t.dist / start.dist)));
      active.rot = start.rot + (t.angle - start.angle);
    } else {
      const p = toFraction(e);
      if (!p) return;
      active.x = Math.max(-0.05, Math.min(1.05, p.fx - start.grabX));
      active.y = Math.max(-0.05, Math.min(1.05, p.fy - start.grabY));
    }
    scheduleDecorateDraw();
  });

  const end = e => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) { active = null; start = null; }
    else if (pointers.size === 1 && active) {
      const p = toFraction([...pointers.values()][0]);
      if (p) start = { grabX: p.fx - active.x, grabY: p.fy - active.y };
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  // Mouse wheel resizes on a desktop, where there is no pinch.
  canvas.addEventListener('wheel', e => {
    const p = toFraction(e);
    if (!p) return;
    const hit = stickerAt(S.stickers, p.fx, p.fy, S.artWindow);
    if (!hit) return;
    e.preventDefault();
    hit.scale = Math.max(0.08, Math.min(0.9, hit.scale * (e.deltaY > 0 ? 0.92 : 1.08)));
    scheduleDecorateDraw();
  }, { passive: false });
}

/* ------------------------------------------------------- frame reveal */

/**
 * The gacha moment: a strip of frames slides past, decelerates, and stops on
 * the one they got. Pure showmanship, and the reason people film these.
 */
function startFrameReveal(frames) {
  if (!frames.length) return;
  const target = frames[Math.floor(Math.random() * frames.length)];
  S.revealTarget = target;
  S.revealPool = frames;
  go('framereveal');
}

ON_ENTER.framereveal = async () => {
  const strip = $('#fr-strip');
  const pool = S.revealPool || [];
  const target = S.revealTarget;
  $('#fr-name').classList.remove('show');
  $('#fr-name').textContent = '\u00a0';

  // Build a long enough run that the strip never shows its ends.
  const CARD_W = 200, GAP = 22, STEP = CARD_W + GAP;
  const LOOPS = 5;
  const seq = [];
  for (let i = 0; i < LOOPS; i++) seq.push(...pool);
  const landing = seq.length;                // target sits just past the loops
  seq.push(target, ...pool);

  strip.innerHTML = seq.map(f => {
    const b = boxFor(f, CARD_W);
    return `<canvas width="${b.W}" height="${b.H}"></canvas>`;
  }).join('');
  const canvases = [...strip.querySelectorAll('canvas')];
  seq.forEach((f, i) => {
    renderCard(canvases[i].getContext('2d'), {
      frame: f, frameId: f.id, W: canvases[i].width, H: canvases[i].height,
      ...photoArgs(f),
      companion: ['party', 'kawaii'].includes(f.template) ? companionThumb(f.energyType) : null,
      // Whatever name they've already typed (on the Name tab) should follow
      // them through the mystery pull too, not just party/kawaii cards.
      personalization: personalizationPayload(),
      card: mintCard({ frame: f, frameId: f.id, mint: 1, forcedRarity: f.rarityFloor || 'rare' }),
      stock: S.cfg.cards?.stock || null,
    });
  });

  // Centre card `i` by translating its centre to the window's centre.
  const centreOf = i => -(i * STEP + CARD_W / 2);
  const from = centreOf(0);
  const to = centreOf(landing);
  const DURATION = 3400;
  const t0 = performance.now();

  await new Promise(resolve => {
    const tick = now => {
      const p = Math.min(1, (now - t0) / DURATION);
      // Strong ease-out: fast blur, long slow settle onto the winner.
      const e = 1 - Math.pow(1 - p, 4.2);
      strip.style.transform = `translate(${from + (to - from) * e}px, -50%)`;
      if (p < 1) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });

  $('#fr-name').textContent = target.name;
  $('#fr-name').classList.add('show');

  await sleep(1500);
  S.frameId = target.id;
  S.previewCard = mintCard({
    frame: target, frameId: target.id,
    seasonId: S.cfg.collection.seasonId, mint: 1, product: S.product,
  });
  go('decorate');
};

/* ------------------------------------------------------- build outputs */

async function buildOutputs() {
  const seasonId = S.cfg.collection.seasonId;
  const mint = await window.booth.cards.nextMint({ seasonId, frameId: S.frameId });

  const frameDef = lookupFrame(S.frameId);
  S.card = mintCard({
    frame: frameDef, frameId: S.frameId, seasonId, mint,
    boothId: S.cfg.booth.id, boothName: S.cfg.booth.displayName,
    product: S.product,
    // The rarity was already rolled (and shown) back in decorate() — lock the
    // final print/print-record to that same result rather than rolling again.
    forcedRarity: S.previewCard?.rarity || null,
  });

  const dpi = S.cfg.printing.dpi || 300;
  const stripStyle = isStrip(frameDef);
  const { W, H } = printSize(stripStyle ? 'strip' : 'card', dpi);

  // Do NOT pre-crop here. Cropping the camera frame to the CARD's portrait
  // aspect and then fitting that into a LANDSCAPE art window crops twice — it
  // throws away most of the frame and pushes the subject off-centre. Hand the
  // renderer the full frame and let drawCover fit whatever window the template
  // actually has.
  const heroImg = await canvasToImage(S.shots[S.heroIndex] || S.shots[0]);

  const usesCompanion = ['party', 'kawaii'].includes(frameDef.template);
  S.cardCanvas = document.createElement('canvas');
  S.cardCanvas.width = W; S.cardCanvas.height = H;
  const heroImgs = stripStyle ? await Promise.all(S.shots.map(canvasToImage)) : [];
  renderCard(S.cardCanvas.getContext('2d'), {
    frame: frameDef, frameId: S.frameId, W, H,
    photo: stripStyle ? null : heroImg,
    photos: heroImgs,
    character: frameDef.character ? placeholderCharacter() : null,
    companion: usesCompanion ? await companionImage() : null,
    card: S.card,
    stock: S.cfg.cards?.stock || null,
    personalization: personalizationPayload(),
    stickers: S.stickers,
    stickerImages: stickerImageMap(),
    approvalMode: !!S.cfg.assetPacks?.approvalMode,
  });

  // Show it on screen at display resolution.
  const view = $('#card-canvas');
  view.width = W; view.height = H;
  view.getContext('2d').drawImage(S.cardCanvas, 0, 0);

  // A strip style already IS the strip — don't print a second one.
  if (S.product.prints?.strip && !stripStyle) {
    const s = printSize('strip', dpi);
    S.stripCanvas = document.createElement('canvas');
    S.stripCanvas.width = s.W; S.stripCanvas.height = s.H;
    const imgs = await Promise.all(S.shots.map(canvasToImage));
    renderStrip(S.stripCanvas.getContext('2d'), { W: s.W, H: s.H, photos: imgs, card: S.card });
  }

  if (S.product.gif && S.burst.length) {
    try { S.gifBlob = await encodeGif(S.burst, S.cfg.delivery.gif); }
    catch (e) { console.warn('gif encode failed', e); }
  }

  await window.booth.cards.record(S.card);
  if (S.product.digital && S.cfg.delivery.uploadEnabled) uploadMedia().catch(e => console.warn('upload failed', e));
}

async function uploadMedia() {
  const files = [{ name: `card-${S.card.serial.replace(/[^\w]+/g, '_')}.png`, dataUrl: S.cardCanvas.toDataURL('image/png') }];
  if (S.stripCanvas) files.push({ name: 'strip.png', dataUrl: S.stripCanvas.toDataURL('image/png') });
  S.shots.forEach((c, i) => files.push({ name: `photo-${i + 1}.jpg`, dataUrl: c.toDataURL('image/jpeg', 0.9) }));
  if (S.gifBlob) files.push({ name: 'boomerang.gif', dataUrl: await blobToDataUrl(S.gifBlob) });

  const res = await fetch(S.cfg.delivery.uploadUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files, card: S.card, collectorId: null }),
  });
  const { url } = await res.json();
  S.downloadUrl = url;

  $('#dl-url').textContent = url;
  $('#dl-qr').src = `${S.cfg.payments.serverUrl}/qr?url=${encodeURIComponent(url)}`;
  $('#dl-block').hidden = false;
}

/* -------------------------------------------------------------- reveal */

ON_ENTER.reveal = () => {
  const r = RARITIES[S.card.rarity];
  const el = $('#pull-rarity');
  el.textContent = r.label;
  el.style.color = r.color;
  $('#rarity-burst').style.setProperty('--burst', r.color);
  const pfr = lookupFrame(S.frameId);
  const named = S.personal.name.trim();
  $('#pull-name').textContent = named ? S.personal.name.trim() : pfr.name;
  $('#pull-serial').textContent = `${pfr.collectorNumber}  ·  ${S.card.serial}`;
  $('#mint-note').textContent = S.card.mintLimit
    ? `Limited edition — only ${S.card.mintLimit} of these will ever be printed.`
    : '';
  $('#btn-retake').hidden = !(S.cfg.capture.allowRetake && S.retakes < S.cfg.capture.maxRetakes);
  $('#btn-print').disabled = !(S.product.prints.card || S.product.prints.strip);
  $('#print-status').textContent = '';
  $('#dl-block').hidden = !S.downloadUrl;

  // The odds were true before the pull happened, so show them again right
  // here — then make finding out what it actually was its own moment.
  const odds = rarityOdds({
    boost: S.product.rarityBoost || 1,
    floor: pfr.rarityFloor || null,
    guarantee: S.product.guaranteeAtLeast || null,
  });
  $('#odds-recap').innerHTML = oddsBreakdownHtml(odds);

  $('#reveal-result').hidden = true;
  const cover = $('#pack-cover');
  cover.hidden = false;
  cover.classList.remove('opening');
  cover.disabled = false;
  cover.onclick = () => {
    if (cover.classList.contains('opening')) return;
    cover.classList.add('opening');
    cover.disabled = true;
    setTimeout(() => {
      cover.hidden = true;
      $('#reveal-result').hidden = false;
    }, 460);
  };
};

async function retake() {
  S.retakes++;
  S.shots = []; S.burst = [];
  S.stickers = [];
  go('capture');
}

/* --------------------------------------------------------------- print */

async function doPrint() {
  const btn = $('#btn-print');
  btn.disabled = true;
  const st = $('#print-status');
  const p = S.cfg.printing;

  try {
    if (S.product.prints.card) {
      st.textContent = `Printing ${S.product.prints.card} card${S.product.prints.card > 1 ? 's' : ''}…`;
      const cardIsStrip = isStrip(lookupFrame(S.frameId));
      const geo = cardIsStrip ? p.strip : p.card;
      const r = await window.booth.printers.print({
        // JPEG, not PNG: the Pi wraps this straight into a PDF via /DCTDecode
        // to get exact physical sizing out of CUPS, and dye-sub is continuous
        // tone anyway so q95 is indistinguishable from lossless on paper.
        dataUrl: S.cardCanvas.toDataURL('image/jpeg', 0.95),
        widthIn: geo.widthIn, heightIn: geo.heightIn,
        printerName: p.cardPrinterName, copies: S.product.prints.card, silent: p.silent,
      });
      if (!r.ok) throw new Error(r.reason || 'Card print was rejected');
    }

    if (S.product.prints.strip && S.stripCanvas) {
      st.textContent = 'Printing your strip…';
      const r = await window.booth.printers.print({
        dataUrl: S.stripCanvas.toDataURL('image/jpeg', 0.95),
        widthIn: p.strip.widthIn, heightIn: p.strip.heightIn,
        printerName: p.stripPrinterName || p.cardPrinterName, copies: 1, silent: p.silent,
      });
      if (!r.ok) throw new Error(r.reason || 'Strip print was rejected');
    }

    st.textContent = 'Sent to the printer.';
    await sleep(900);
    go('thanks');
  } catch (e) {
    st.textContent = `Print failed: ${e.message}`;
    toast('Print failed — the operator can refund this sale.', true);
    btn.disabled = false;
  }
}

ON_ENTER.thanks = () => {
  $('#thanks-sub').textContent = S.downloadUrl
    ? 'Your digital copy is on your phone — scan the code again on the previous screen if you missed it.'
    : 'Thanks for playing.';
  setTimeout(() => { if (S.screen === 'thanks') go('attract'); }, 12000);
};

/* ------------------------------------------------------------ operator */

ON_ENTER.admin = async () => {
  const [info, sales, stats, printers] = await Promise.all([
    window.booth.app.info(),
    window.booth.sales.summary(),
    window.booth.cards.stats({ seasonId: S.cfg.collection.seasonId }),
    window.booth.printers.list(),
  ]);
  const devices = S.camera?.devices || await new Camera(S.cfg.camera).listDevices().catch(() => []);

  $('#admin-body').innerHTML = `
    <div class="card-panel">
      <h3>Today</h3>
      <div class="kv"><span>Sales</span><b>${sales.todayCount}</b></div>
      <div class="kv"><span>Gross</span><b>${money(sales.todayGross)}</b></div>
      <div class="kv"><span>Cards this season</span><b>${stats.total}</b></div>
      <div class="kv"><span>All time</span><b>${sales.allCount} · ${money(sales.allGross)}</b></div>
    </div>

    <div class="card-panel">
      <h3>Pull distribution</h3>
      ${Object.entries(RARITIES).map(([id, r]) =>
        `<div class="kv"><span style="color:${r.color}">${r.symbol} ${r.label}</span><b>${stats.byRarity?.[id] || 0}</b></div>`).join('')}
    </div>

    <div class="card-panel">
      <h3>Camera</h3>
      ${devices.length
        ? devices.map(d => `<div class="kv"><span>${d.label || 'unnamed'}</span><b>${d.deviceId === S.camera?.deviceId ? 'IN USE' : ''}</b></div>`).join('')
        : '<div class="kv"><span>No video devices found</span></div>'}
      <p style="color:var(--ink-dim);font-size:13px;margin-top:12px">
        Add part of the capture card's name to <code>camera.preferredLabels</code> in booth.config.json.</p>
    </div>

    <div class="card-panel">
      <h3>Printers</h3>
      ${printers.length
        ? printers.map(p => `<div class="kv"><span>${p.displayName || p.name}</span><b>${p.isDefault ? 'DEFAULT' : ''}</b></div>`).join('')
        : '<div class="kv"><span>None detected</span></div>'}
    </div>

    <div class="card-panel">
      <h3>Asset packs</h3>
      ${S.packGroups.length
        ? S.packGroups.map(g => `<div class="kv"><span>${g.name}</span><b>${g.frames.length} frames</b></div>`).join('')
        : '<div class="kv"><span>None loaded</span></div>'}
      ${(S.packErrors || []).map(e => `<div class="kv"><span style="color:var(--bad)">${e.id}</span><b style="color:var(--bad)">failed</b></div>`).join('')}
      ${S.cfg.assetPacks?.approvalMode
        ? '<div class="kv"><span style="color:var(--bad)">APPROVAL MODE</span><b style="color:var(--bad)">cards are stamped</b></div>'
        : ''}
    </div>

    <div class="card-panel">
      <h3>System</h3>
      <div class="kv"><span>Booth</span><b>${S.cfg.booth.id}</b></div>
      <div class="kv"><span>Season</span><b>${S.cfg.collection.seasonId}</b></div>
      <div class="kv"><span>Payments</span><b>${S.cfg.payments.provider}</b></div>
      <div class="kv"><span>Version</span><b>${info.version} · ${info.platform}</b></div>
      <div class="kv"><span>Bridge</span><b>${S.platform}</b></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn btn-ghost" id="admin-reload">Reload app</button>
        <button class="btn btn-ghost" id="admin-quit">Quit</button>
      </div>
    </div>`;

  $('#admin-reload')?.addEventListener('click', () => window.booth.app.reload());
  $('#admin-quit')?.addEventListener('click', () => window.booth.app.quit());
};

/* --------------------------------------------------------------- utils */

function canvasToImage(canvas) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = canvas.toDataURL('image/png');
  });
}

function blobToDataUrl(blob) {
  return new Promise(resolve => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(blob);
  });
}

boot().catch(e => {
  document.body.innerHTML = `<pre style="color:#ff8080;padding:40px;font:14px monospace">Startup failed:\n${e.stack}</pre>`;
});
