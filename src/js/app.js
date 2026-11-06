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

import { pickerGroups, allFrames, frameById, frameAspect, frameBox, RARITIES, RARITY_ORDER, SET, energy, themeFor } from './frames/packs.mjs';
import { rarityOdds } from './frames/rarity.mjs';
import { COMPANIONS, companionById, companionCanvas } from './frames/companions.mjs';
import { loadPack, packFrames } from './frames/assetpack.mjs';
import { stickerCatalog, stickerCanvas, newPlacement, stickerAt, DECOS } from './frames/stickers.mjs';
import { renderCard, renderStrip, mintCard, printSize } from './frames/render.mjs';
import { Camera, StillsCamera, applyPhotoFilter, cameraLog, clog, cameraRoles, matchRoles, stopActiveCamera } from './camera.js';
import { loadFonts } from './frames/fonts.mjs';
import { setStripEvent } from './frames/strips.mjs';
import { toPrinterNative, printRotations, NATIVE, CALIBRATION_DESIGN, coverCrop, coverPlacement, cardSheetLayout, drawCalibration, buildStampText, drawBuildStamp, toDriverFrame, windowsTurn } from './layout.mjs';
import { createPaymentProvider, kioskHeaders } from './payments.js';
import { encodeGif } from './gif.js';

import { installBridge, PLATFORMS } from './bridge.js';

/* --------------------------------------------------------------- state */

const S = {
  cfg: null,
  screen: 'attract',
  frameId: null,
  product: null,
  payment: null,
  shots: [],          // full-res captured canvases, always the untouched originals
  filteredShots: [],  // shots with S.filterId applied — what actually gets rendered/printed
  burst: [],
  filteredBurst: [],
  heroIndex: 0,
  card: null,
  cardCanvas: null,
  stripCanvas: null,
  gifBlob: null,
  downloadUrl: null,
  retakes: 0,
  camera: null,
  cameraAngle: null,
  filterId: null,
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
  pokemonImages: {},
  stripFrameId: null,
  stripCustomColor: null, // hex, set instead of stripFrameId when "Custom" is picked
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
 * "Surprise me" tries the real AI generator first (server/index.js holds the
 * Anthropic key — the kiosk never sees it, same reasoning as Stripe) and
 * falls back to this local word-list generator whenever that isn't
 * configured, isn't reachable, or doesn't answer in time. Every
 * prefix/suffix pair is kept to 14 characters or under (the tightest of the
 * two name fields' own limits), so the fallback always fits without
 * truncating wherever it lands.
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

/** Keep whatever the AI (or anything else) hands back inside the same shape
 *  a typed name has to obey: letters/apostrophes/hyphens, at most two words,
 *  14 characters — so it can never be the thing that breaks a card layout. */
function sanitizeGeneratedName(raw) {
  const words = String(raw || '')
    .replace(/[^a-zA-Z' -]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  const name = words.join(' ').slice(0, 14).trim();
  return name || null;
}

/**
 * Ask the local server for a real AI-generated name; give up (and hand back
 * null) on any error, timeout, or disabled config so the caller can fall
 * back to generateCharacterName() without the button ever visibly failing.
 */
async function aiCharacterName(theme) {
  const ai = S.cfg?.ai;
  if (!ai?.enabled || !ai?.serverUrl) return null;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ai.timeoutMs || 6000);
    const res = await fetch(`${ai.serverUrl}/ai/name`, {
      method: 'POST',
      headers: kioskHeaders(S.cfg.server?.kioskKey),
      body: JSON.stringify({ theme: theme || '' }),
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const { name } = await res.json();
    return sanitizeGeneratedName(name);
  } catch {
    return null;
  }
}

/** Surprise-me for either name field: try AI, fall back to the offline
 *  generator, and give the button a brief busy state while it waits. */
async function surpriseName(btn, theme) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Generating…';
  try {
    return (await aiCharacterName(theme)) || generateCharacterName();
  } finally {
    btn.textContent = label;
    btn.disabled = false;
  }
}

/* -------------------------------------------------------- name suggest */

/**
 * Type-ahead suggestions for the name field, drawn from this set's own
 * original creatures and promos rather than any outside character list —
 * same reasoning as declining to source stickers from Pokémon-clipart sites
 * earlier: this booth doesn't put someone else's trademarked names on a
 * paid product. Built once, since the catalogue doesn't change at runtime.
 */
const SUGGESTED_NAMES = allFrames()
  .filter(f => f.packId === 'basics' || f.promo)
  .map(f => f.baseName)
  .sort((a, b) => a.localeCompare(b));

/** Show up to 5 names starting with what's typed so far; hide entirely once
 *  the field is empty or already matches a suggestion exactly. */
function renderNameSuggestions(host, query, onPick) {
  const q = query.trim().toLowerCase();
  const matches = q && !SUGGESTED_NAMES.some(n => n.toLowerCase() === q)
    ? SUGGESTED_NAMES.filter(n => n.toLowerCase().startsWith(q)).slice(0, 5)
    : [];
  host.hidden = matches.length === 0;
  host.innerHTML = matches.map(n =>
    `<span class="sugg" data-name="${n}"><b>${n.slice(0, q.length)}</b>${n.slice(q.length)}</span>`
  ).join('');
  host.onclick = e => {
    const name = e.target.closest('.sugg')?.dataset.name;
    if (name) onPick(name);
  };
}

/* ---------------------------------------------------------- navigation */

function go(name) {
  // Free event: no pay screen at all — straight from the product to the shoot.
  if (name === 'pay' && S.cfg?.payments?.provider === 'free') return startFreeSession();
  if (name !== S.screen) clog(`screen: ${S.screen || '-'} → ${name}`);
  S.screen = name;
  $$('.screen').forEach(el => (el.hidden = el.dataset.screen !== name));
  resetIdle();
  ON_ENTER[name]?.();
}

function resetIdle() {
  clearTimeout(S.idleTimer);
  const ms = S.screen === 'attract' ? null
    : ['capture', 'pay', 'angle'].includes(S.screen) ? S.cfg.booth.sessionTimeoutMs
    : S.cfg.booth.idleAttractAfterMs;
  if (ms) S.idleTimer = setTimeout(() => { abandon(); }, ms);
}

function abandon() {
  S.camera?.stop('session ended');
  stopActiveCamera();
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
  // Never let a test session look like a real one (or the other way round).
  if (S.cfg.payments?.provider === 'mock') {
    const badge = document.createElement('div');
    badge.className = 'test-mode-badge';
    badge.textContent = 'TEST MODE · payments simulated';
    document.body.appendChild(badge);
  }
  clog(`boot: ${navigator.userAgent.match(/(Chrome|Electron)\/[\d.]+/g)?.join(' ') || navigator.userAgent}, ` +
    `windowsCaptureApi=${S.cfg.camera?.windowsCaptureApi || 'mediafoundation'}, hwMjpeg=${!!S.cfg.camera?.windowsHardwareMjpeg}, ` +
    `cameras=${cameraRoles(S.cfg).map(r => `${r.id}${r.mode ? `/${r.mode}` : ''}:${JSON.stringify(r.match)}${r.deviceLabel ? ` saved "${r.deviceLabel}"` : ''}`).join(' ')}`);

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
    const tpl = currentFrame()?.template;
    go(['party', 'kawaii', 'assetPack'].includes(tpl) || currentFrame()?.personalize ? 'personalize' : 'product');
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
    // Simulated smart reader: T taps a working card, D a declining one.
    if (S.screen === 'pay' && (e.key === 't' || e.key === 'd')) {
      S.pay?.simulateTap?.(e.key === 'd').catch(err => toast(`Simulated tap failed: ${err.message}`, true));
    }
    if (e.key === 'Escape') abandon();
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) go('diagnostics');
    if (e.key === '`') document.body.classList.toggle('debug');
  });

  // The strip collection's typefaces (src/fonts) and the event's own text/logo.
  clog(`fonts: ${await loadFonts('fonts/').catch(() => 0)} loaded`);
  await setupStripEvent();
  await loadAssetPacks();
  await loadPokemonCharacters();
  buildPicker();
  go('attract');
}

async function loadPokemonCharacters() {
  const frames = allFrames().filter(f => f.packId === 'basics' && f.character?.file);
  await Promise.all(frames.map(f => new Promise(resolve => {
    const img = new Image();
    img.onload = () => { S.pokemonImages[f.character.file] = img; resolve(); };
    img.onerror = () => resolve();
    img.src = `../images/${f.character.file}`;
  })));
}

function pokemonCharacter(frame) {
  return frame?.character ? S.pokemonImages[frame.character.file] || null : null;
}

/* ------------------------------------------------------------- attract */

const ON_ENTER = {};

ON_ENTER.attract = async () => {
  S.shots = []; S.filteredShots = []; S.burst = []; S.filteredBurst = []; S.card = null; S.retakes = 0;
  S.gifBlob = null; S.downloadUrl = null; S.payment = null;
  S.personal = { name: '', age: '', companionId: null };
  S.companionImg = null;
  S.stickers = [];
  S.artWindow = null;
  S.previewCard = null;
  S.stripFrameId = null;
  S.stripCustomColor = null;
  S.cameraAngle = null;
  S.filterId = S.cfg.filters?.default || null;
  S.camera?.stop('new session');

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

/** Strips (2x6) and Jumbo strips (4x6) both use every shot. */
function isStrip(frame) {
  return frame?.template === 'strip' || frame?.template === 'jumbo';
}

function isJumbo(frame) {
  return frame?.template === 'jumbo';
}

/** printSize() kind for a frame: 'card' 750x1050, 'strip' 620x1844, 'jumbo' 1240x1844. */
function sizeKind(frame) {
  return isJumbo(frame) ? 'jumbo' : isStrip(frame) ? 'strip' : 'card';
}

/**
 * strips.event in booth.config.json: the host's event title, date, message
 * and logo, shown by the Photo Strip Collection designs.
 */
async function setupStripEvent() {
  const ev = S.cfg.strips?.event || {};
  let logo = null;
  if (ev.logo) {
    logo = await new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { clog(`warn: strips.event.logo "${ev.logo}" didn't load`); resolve(null); };
      img.src = /^(https?:|data:|\/)/.test(ev.logo) ? ev.logo : `../${ev.logo}`;
    });
  }
  setStripEvent(ev, logo);
}

/** Strips need every shot; cards need the chosen one. */
function photoArgs(frame) {
  return isStrip(frame)
    ? { photos: S.filteredShots.length ? S.filteredShots : [placeholderPhoto()], photo: null }
    : { photo: S.filteredShots[S.heroIndex] || placeholderPhoto(), photos: [] };
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
    tile.className = 'frame-tile' + (isStrip(f) && !isJumbo(f) ? ' tall' : '') + (isJumbo(f) ? ' jumbo' : '');
    tile.dataset.frame = f.id;
    const cv = document.createElement('canvas');
    const box = boxFor(f, 360);
    cv.width = box.W; cv.height = box.H;
    tile.append(cv);
    const e = energy(f.energyType);
    tile.insertAdjacentHTML('beforeend', `
      <div class="nm"><i class="type-dot" style="background:${f.swatch || e.base}"></i>${f.name}</div>
      <div class="mt">
        <span class="num">${f.collectorNumber}</span>
        ${f.availability?.mintLimit
          ? `<span class="badge-limited">${f.availability.mintLimit} only</span>`
          : f.family ? `<span>${f.family}</span>` : `<span>${e.name} · ${f.hp} HP</span>`}
      </div>`);
    grid.append(tile);

    // Thumbnails render through the same engine as the print master — so a
    // frame can never look one way in the picker and another on the card.
    renderCard(cv.getContext('2d'), {
      frame: f, frameId: f.id, W: box.W, H: box.H,
      photo: placeholderPhoto(),
      photos: isStrip(f) ? [placeholderPhoto(), placeholderPhoto(), placeholderPhoto(), placeholderPhoto()] : [],
      character: pokemonCharacter(f),
      companion: (f.template === 'party' || f.template === 'kawaii') ? companionThumb(f.energyType) : null,
      card: mintCard({ frame: f, frameId: f.id, seasonId: S.cfg.collection.seasonId, mint: 1, forcedRarity: f.rarityFloor || 'rare' }),
      stock: S.cfg.cards?.stock || null,
      // The picker preview uses the actual Pokémon name; customers can change
      // it later in the decorate screen before printing.
      // (Collection strips show their own default text, not the frame's name.)
      personalization: f.style ? {} : { name: f.name, age: 7 },
      foil: true,
    });

    tile.addEventListener('click', () => {
      $$('.frame-tile').forEach(x => x.classList.toggle('on', x === tile));
      S.frameId = f.id;
      S.stripCustomColor = null;
      if (isStrip(f)) S.stripFrameId = f.id;
      $('#picked-label').textContent = isStrip(f)
        ? `${f.name} — photo strip`
        : `${f.name} — ${f.collectorNumber} · ${energy(f.energyType).name}`;
      $('#to-product').disabled = false;
    });
  }

  // A "Custom" tile alongside the strip presets — picking a color here
  // works exactly like tapping a preset tile (same S.frameId, so mint/dex
  // still treat it as that base strip), just with S.stripCustomColor set so
  // currentFrame() swaps in a custom theme everywhere it renders or prints.
  if (group.id === 'strips' && stripChoices().length) {
    const base = stripChoices()[0];
    const tile = document.createElement('div');
    tile.className = 'frame-tile tall frame-tile-custom';
    const cv = document.createElement('canvas');
    const box = boxFor(base, 360);
    cv.width = box.W; cv.height = box.H;
    tile.append(cv);
    tile.insertAdjacentHTML('beforeend', `
      <div class="nm"><i class="type-dot rainbow"></i>Custom color</div>
      <div class="mt"><span>Pick any color</span></div>
      <input type="color" id="frame-strip-custom-color" value="${S.stripCustomColor || DEFAULT_STRIP_CUSTOM_COLOR}">`);
    grid.append(tile);

    const drawPreview = hex => renderCard(cv.getContext('2d'), {
      frame: stripFrameWithColor(hex, base), frameId: base.id, W: box.W, H: box.H,
      photo: null, photos: [placeholderPhoto(), placeholderPhoto(), placeholderPhoto(), placeholderPhoto()],
      card: mintCard({ frame: base, frameId: base.id, seasonId: S.cfg.collection.seasonId, mint: 1, forcedRarity: base.rarityFloor || 'rare' }),
      stock: S.cfg.cards?.stock || null,
      personalization: { name: base.name, age: 7 },
      foil: true,
    });
    drawPreview(S.stripCustomColor || DEFAULT_STRIP_CUSTOM_COLOR);
    tile.classList.toggle('on', !!S.stripCustomColor);

    const colorInput = $('#frame-strip-custom-color');
    colorInput.addEventListener('input', () => drawPreview(colorInput.value));
    colorInput.addEventListener('change', () => {
      $$('.frame-tile').forEach(x => x.classList.toggle('on', x === tile));
      S.frameId = base.id;
      S.stripFrameId = base.id;
      S.stripCustomColor = colorInput.value;
      $('#picked-label').textContent = `${base.name} — photo strip, custom color`;
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

const KB_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM&'];
let pzBuilt = false;

ON_ENTER.personalize = () => {
  if (!pzBuilt) buildPersonalizeUI();
  // Collection strips: names (and an age for birthdays), no buddy.
  const pf = currentFrame();
  const strip = !!pf?.style;
  $('#buddies').closest('.fld').hidden = strip;
  $('#fld-age').closest('.fld').hidden = strip && pf.style !== 'partypop';
  $('#pad').hidden = strip && pf.style !== 'partypop';
  $('#fld-name').closest('.fld').querySelector('span').textContent = strip
    ? (['loveletter', 'keepsake'].includes(pf.style) ? 'Your names (e.g. SARAH & JAMES)' : 'Name on the strip')
    : 'Name on the card';
  // Default the buddy to one matching the chosen card's colour, so the card
  // already looks finished before they touch anything.
  if (!S.personal.companionId) {
    const type = currentFrame()?.energyType;
    S.personal.companionId = (COMPANIONS.find(c => c.type === type) || COMPANIONS[0]).id;
    syncBuddySelection();
  }
  refreshPersonalize();
};

function buildPersonalizeUI() {
  pzBuilt = true;

  buildKeyboard($('#kb'), {
    max: 18,
    get: () => S.personal.name,
    set: v => { S.personal.name = v; },
    onChange: refreshPersonalize,
  });

  $('#pz-gen-name').addEventListener('click', async e => {
    const theme = energy(currentFrame()?.energyType)?.name;
    S.personal.name = await surpriseName(e.currentTarget, theme);
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
  renderNameSuggestions($('#pz-name-suggest'), S.personal.name, name => {
    S.personal.name = name;
    refreshPersonalize();
  });
  ageEl.textContent = S.personal.age || '';
  ageEl.classList.toggle('is-empty', !S.personal.age);

  const ready = S.personal.name.trim().length >= 1;
  $('#pz-done').disabled = !ready;
  $('#pz-summary').textContent = ready
    ? `${S.personal.name.trim()}${S.personal.age ? `, ${S.personal.age}` : ''}${currentFrame()?.style ? '' : ` · ${companionById(S.personal.companionId)?.name || ''}`}`
    : 'Type a name to start';

  // Live preview, debounced — every keypress would otherwise redraw a card.
  clearTimeout(pzTimer);
  pzTimer = setTimeout(drawPersonalizePreview, 90);
}

async function drawPersonalizePreview() {
  const cv = $('#pz-canvas');
  const pf = currentFrame();
  // Shaped like the frame: a card, a 2x6 strip or a 4x6 Jumbo.
  const b = boxFor(pf, 1000);
  cv.height = 700; cv.width = Math.round(700 * b.W / b.H);
  renderCard(cv.getContext('2d'), {
    frame: pf, frameId: S.frameId, W: cv.width, H: cv.height,
    photo: placeholderPhoto(),
    photos: isStrip(pf) ? [0, 1, 2, 3].map(() => placeholderPhoto()) : [],
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
  const typedName = S.personal.name.trim();
  // Collection strips show their own title when nothing's typed, never the frame's name.
  return {
    name: typedName || (currentFrame()?.style ? '' : currentFrame()?.name || ''),
    age: S.personal.age === '' ? null : Number(S.personal.age),
    companionId: S.personal.companionId,
  };
}

/* ------------------------------------------------------------- product */

function stripChoices() {
  return allFrames().filter(f => f.template === 'strip');
}

/** A strip frame with its color swapped to a customer-picked hex. Keeps the
 *  base's own id/collectorNumber/packId/etc — mint records and dex progress
 *  read those, and a custom color is a cosmetic override, not a new card to
 *  collect — only `theme` changes. */
function stripFrameWithColor(hex, base = stripChoices()[0]) {
  return { ...base, theme: themeFor(hex, 'strip') };
}

/** The bonus strip's frame on a card+strip combo (its own separate theme
 *  choice from showStripThemePicker(), independent of the main frame). */
function currentStripFrame() {
  if (S.stripCustomColor) return stripFrameWithColor(S.stripCustomColor, lookupFrame(S.stripFrameId) || stripChoices()[0]);
  return lookupFrame(S.stripFrameId) || stripChoices()[0];
}

/** The main chosen frame, with a customer-picked custom strip color applied
 *  when active — use this instead of a raw catalog lookup everywhere a frame
 *  feeds a preview, print, or record, so a custom color is always reflected
 *  consistently. */
function currentFrame() {
  const f = lookupFrame(S.frameId);
  return (f && isStrip(f) && S.stripCustomColor) ? stripFrameWithColor(S.stripCustomColor, f) : f;
}

const DEFAULT_STRIP_CUSTOM_COLOR = '#e889b5';

function showStripThemePicker() {
  const picker = $('#strip-theme-picker');
  const grid = $('#strip-theme-grid');
  const choices = stripChoices();
  picker.hidden = false;
  grid.innerHTML = choices.map(f => `
    <button class="strip-theme ${!S.stripCustomColor && f.id === S.stripFrameId ? 'on' : ''}" data-strip-theme="${f.id}" type="button" aria-label="${f.name}">
      <span class="strip-theme-swatch" style="--strip-color:${f.swatch || energy(f.energyType).base}"></span>
    </button>`).join('') + `
    <label class="strip-theme strip-theme-custom${S.stripCustomColor ? ' on' : ''}">
      <span class="strip-theme-swatch${S.stripCustomColor ? '' : ' rainbow'}" style="--strip-color:${S.stripCustomColor || 'transparent'}"></span>
      Custom
      <input type="color" id="strip-custom-color" value="${S.stripCustomColor || DEFAULT_STRIP_CUSTOM_COLOR}">
    </label>`;

  grid.querySelectorAll('[data-strip-theme]').forEach(button => button.addEventListener('click', () => {
    S.stripFrameId = button.dataset.stripTheme;
    S.stripCustomColor = null;
    grid.querySelectorAll('.strip-theme').forEach(b => b.classList.toggle('on', b === button));
    go('pay');
  }));

  // 'change' (not 'input') so it only advances once the color wheel actually
  // closes with a choice made, not on every drag update while it's open.
  $('#strip-custom-color').addEventListener('change', e => {
    S.stripCustomColor = e.target.value;
    S.stripFrameId = null;
    go('pay');
  });
}

function showCardThemePicker() {
  const picker = $('#card-theme-picker');
  const grid = $('#card-theme-grid');
  const choices = allFrames().filter(f => f.packId === 'basics');
  picker.hidden = false;
  grid.innerHTML = choices.map(f => `
    <button class="strip-theme ${f.id === S.frameId ? 'on' : ''}" data-card-theme="${f.id}" type="button">
      <span class="strip-theme-swatch" style="--strip-color:${f.swatch || energy(f.energyType).base}"></span>${f.name}
    </button>`).join('');
  grid.querySelectorAll('[data-card-theme]').forEach(button => button.addEventListener('click', () => {
    S.frameId = button.dataset.cardTheme;
    grid.querySelectorAll('.strip-theme').forEach(b => b.classList.toggle('on', b === button));
    go('pay');
  }));
}

ON_ENTER.product = () => {
  const frame = currentFrame();
  const selectedStrip = isStrip(frame);
  const visibleProducts = S.cfg.pricing.products.filter(p => {
    const cardCount = p.prints?.card || 0;
    const stripCount = p.prints?.strip || 0;
    const jumboCount = p.prints?.jumbo || 0;
    // Keep checkout offers focused on the format the customer selected.
    if (isJumbo(frame)) return jumboCount > 0 || p.id === 'digital_strip';
    if (selectedStrip) return (stripCount > 0 && !jumboCount) || p.id === 'digital_strip';
    return (cardCount > 0 && !jumboCount) || p.id === 'digital_card';
  });

  $('#products').innerHTML = visibleProducts.map(p => {
    return `
    <div class="product ${p.featured ? 'featured' : ''}" data-product="${p.id}">
      ${p.featured ? '<span class="tag">MOST POPULAR</span>' : ''}
      <h3>${p.name}</h3>
      <div class="blurb">${p.blurb}</div>
      <div class="price">${S.cfg.payments?.provider === 'free' ? (S.cfg.payments?.freeLabel || 'Free') : money(p.amount)}</div>
    </div>`;
  }).join('');

  $$('.product').forEach(el => el.addEventListener('click', () => {
    S.product = S.cfg.pricing.products.find(p => p.id === el.dataset.product);
    const combo = S.product.prints?.card > 0 && S.product.prints?.strip > 0;
    const needsStripTheme = S.product.prints?.strip && !isStrip(frame);
    const needsCardTheme = combo && isStrip(frame);
    $('#strip-theme-picker').hidden = true;
    $('#card-theme-picker').hidden = true;
    if (needsCardTheme) {
      showCardThemePicker();
    } else if (needsStripTheme) {
      S.stripFrameId = S.stripFrameId || stripChoices()[0]?.id || null;
      showStripThemePicker();
    } else go('pay');
  }));

  $('#strip-theme-picker').hidden = true;
  $('#card-theme-picker').hidden = true;

  if (frame) $('[data-screen="product"] h2').textContent = `${frame.name} — what do you want?`;
};

/* ----------------------------------------------------------------- pay */

/** Free event mode: record the session (amount 0) and go to the shoot. */
async function startFreeSession() {
  S.payment = { ok: true, method: 'free', paymentId: 'free_' + Date.now().toString(36), amount: 0 };
  await window.booth.sales.record({
    at: new Date().toISOString(), amount: 0, productId: S.product.id,
    frameId: S.frameId, paymentId: S.payment.paymentId, method: 'free', boothId: S.cfg.booth.id,
  }).catch(() => {});
  go(cameraAngles().length >= 2 ? 'angle' : 'capture');
}

ON_ENTER.pay = async () => {
  $('#pay-amount').textContent = money(S.product.amount);
  $('#pay-product').textContent = S.product.name;
  $('#pay-qr').hidden = true;
  const status = $('#pay-status');
  status.classList.remove('err');

  S.pay = createPaymentProvider(
    { ...S.cfg.payments, currency: S.cfg.booth.currency, boothId: S.cfg.booth.id, kioskKey: S.cfg.server?.kioskKey },
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

  let res;
  try {
    res = await S.pay.collect(S.product, {
      frameId: S.frameId, boothId: S.cfg.booth.id, season: S.cfg.collection.seasonId,
    });
  } catch (e) {
    res = { ok: false, error: e.message };
  }

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
  // Two physical cameras (e.g. a second, high-angle capture card) means a
  // choice to make before the shoot; one camera means there's nothing to
  // ask, so the flow skips straight to capture exactly as it always did.
  go(cameraAngles().length >= 2 ? 'angle' : 'capture');
};

/** The cameras turned on in config.cameras (standard = Brio, wide = Canon M50). 2 = the angle picker is shown. */
function cameraAngles() {
  return cameraRoles(S.cfg);
}

/**
 * camera.stills: the main camera takes real photos over USB (focus, flash,
 * full resolution) instead of grabbing video frames. With several angles it
 * applies to stills.angle (default: the first one); the others stay video.
 */
function usesStills(angleId) {
  const st = S.cfg.camera?.stills;
  if (!st?.enabled || !window.booth?.stills) return false;
  const angles = cameraAngles();
  if (angles.length < 2) return true;
  return (angleId || angles[0].id) === (st.angle || angles[0].id);
}
const defaultRole = () => cameraAngles()[0]?.id || 'standard';
const makeCamera = role => (usesStills(role) ? new StillsCamera(S.cfg, role) : new Camera(S.cfg, role));

/** A tethered camera that won't start shouldn't cost a paid customer their shoot: fall back to video. */
function stillsFallback(error) {
  console.error(`[stills] ${error.message} — falling back to the video feed. Check that digiCamControl ` +
    '(Windows) is running with its web server on, or that gphoto2 sees the camera (Mac/Pi), and that ' +
    'nothing else (Lumabooth, EOS Webcam Utility, Canon EOS Utility) has the camera.');
  toast(`Photo camera unavailable (${error.message}) — using the video feed`, true);
}

/** Configured camera-look filters, or [] if the picker is off/unconfigured. */
function filterChoices() {
  return S.cfg.filters?.list || [];
}
function filtersEnabled() {
  return !!S.cfg.filters?.enabled && filterChoices().length > 0;
}
function lookupFilter(id) {
  return filterChoices().find(f => f.id === id) || null;
}
/** Bakes the currently-chosen filter onto the untouched originals once, so
 *  everything downstream (card/strip render, gif, shot-picker thumbnails)
 *  draws from S.filteredShots without redoing the canvas work per frame.
 *  S.shots itself is never touched — picking "Original" just re-derives from
 *  it with a no-op filter, which is how "remove it" gets you the original. */
function finalizeFilterSelection() {
  const filter = lookupFilter(S.filterId);
  S.filteredShots = S.shots.map(s => applyPhotoFilter(s, filter));
  S.filteredBurst = S.burst.map(s => applyPhotoFilter(s, filter));
  go('decorate');
}

/* --------------------------------------------------------- camera angle */

ON_ENTER.angle = async () => {
  const host = $('#angle-options');
  const video = $('#angle-preview');
  // A live preview of the chosen camera. One stream at a time (camera.js):
  // pressing the other button stops this camera before opening that one.
  S.camera?.stop('camera page opened');
  stopActiveCamera('camera page opened');
  video.srcObject = null;
  $('#angle-start').disabled = true;
  setAnglePreview('Checking cameras…');
  const roles = cameraAngles();
  host.innerHTML = roles.map(a => `
    <div class="angle-option${a.id === S.cameraAngle ? ' on' : ''}" data-angle="${a.id}">
      <div class="ic">${a.icon || '📷'}</div>
      <div class="lbl">${escapeHtml(a.label)}</div>
      ${a.sub ? `<div class="sub">${escapeHtml(a.sub)}</div>` : ''}
      <div class="angle-status" data-angle-status="${a.id}">Checking…</div>
    </div>`).join('');
  const token = S.angleToken = {};
  let matches = {};
  try { ({ matches } = await matchRoles(S.cfg)); } catch (e) { clog(`angle picker: ${e.message}`); }
  if (S.angleToken !== token || S.screen !== 'angle') return;
  for (const a of roles) {
    const m = matches[a.id];
    host.querySelector(`[data-angle="${a.id}"]`)?.classList.toggle('missing', !m);
    const el = host.querySelector(`[data-angle-status="${a.id}"]`);
    if (el) {
      el.textContent = m ? 'Ready' : `${a.name} not found`;
      el.classList.toggle('bad', !m);
    }
  }
  host.onclick = e => {
    const id = e.target.closest('.angle-option')?.dataset.angle;
    if (!id) return;
    const a = roles.find(r => r.id === id);
    if (!matches[id]) {
      toast(`${a.name} not found — check it's plugged in and switched on.`, true);
      return;
    }
    previewAngle(id);
  };
  $('#angle-start').onclick = () => {
    if (S.cameraAngle && matches[S.cameraAngle]) go('capture');
  };
  // Start on the last camera used (a retake), else the first one plugged in.
  const first = S.cameraAngle && matches[S.cameraAngle] ? S.cameraAngle : roles.find(r => matches[r.id])?.id;
  if (first) previewAngle(first);
  else setAnglePreview(roles.length ? `${roles.map(r => r.name).join(' and ')} not found` : 'No cameras set up in booth.config.json', true);
};

/** The camera page's preview message: a status, or a visible error (bad). */
function setAnglePreview(text, bad = false) {
  const el = $('#angle-live-status');
  el.textContent = text || '';
  el.hidden = !text;
  el.classList.toggle('bad', bad);
}

/** Shows the chosen camera live on the camera page. */
async function previewAngle(id) {
  S.cameraAngle = id;
  $$('#angle-options .angle-option').forEach(t => t.classList.toggle('on', t.dataset.angle === id));
  const token = S.previewToken = {};
  const current = () => S.previewToken === token && S.screen === 'angle';
  const video = $('#angle-preview');
  const start = $('#angle-start');
  start.disabled = true;
  if (S.camera && (S.camera.role !== id || !!S.camera.stills !== usesStills(id))) { S.camera.stop('other camera chosen'); S.camera = null; }
  const cam = (S.camera ||= makeCamera(id));
  cam.onStatus = st => { if (current() && st.level !== 'ok') setAnglePreview(st.message, true); };
  setAnglePreview(`Starting ${cam.rc?.name || 'camera'}…`);
  try {
    if (cam.isLive) await cam.attach(video);
    else await cam.start(video);
    if (!current()) return;
    await cam.verifyLive(1000);
    if (!current()) return;
    setAnglePreview('');
    start.disabled = false;
  } catch (e) {
    if (e.code === 'CAMERA_STOPPED' || !current()) return; // another button was pressed meanwhile
    clog(`camera page: ${e.message}`);
    setAnglePreview(e.message, true);
  }
}

/* -------------------------------------------------------- camera filter */

/**
 * Shown right after the shoot, on the actual photo just taken — not a live
 * camera preview. Tapping a tile only previews that look (so the customer can
 * flip through all of them on their real photo before deciding); nothing is
 * final, including the current choice, until Next is tapped. "Original" is
 * just another tile, so backing out of a filter they don't like is the same
 * one tap as picking one in the first place.
 */
ON_ENTER.filter = () => {
  if (!lookupFilter(S.filterId)) S.filterId = filterChoices()[0]?.id || null;
  // Every photo from the shoot, each rendered through the real filter
  // (grain and vignette included), so the preview is exactly what prints.
  // Scaled-down copies keep re-rendering on each tap instant.
  const grid = $('#filter-grid');
  const PREVIEW_W = 720;
  const smalls = S.shots.map(shot => {
    const k = Math.min(1, PREVIEW_W / shot.width);
    const c = document.createElement('canvas');
    c.width = Math.round(shot.width * k); c.height = Math.round(shot.height * k);
    c.getContext('2d').drawImage(shot, 0, 0, c.width, c.height);
    return c;
  });
  grid.classList.toggle('single', smalls.length === 1);
  grid.innerHTML = smalls.map((_, i) => `<canvas data-shot="${i}" data-w="${S.shots[i].width}" data-h="${S.shots[i].height}"></canvas>`).join('');
  const renderPreviews = () => {
    const filter = lookupFilter(S.filterId);
    smalls.forEach((small, i) => {
      const out = applyPhotoFilter(small, filter);
      const c = grid.children[i];
      c.width = out.width; c.height = out.height;
      c.getContext('2d').drawImage(out, 0, 0);
    });
  };

  const host = $('#filter-options');
  const renderTiles = () => {
    host.innerHTML = filterChoices().map(f => `
      <div class="filter-option${f.id === S.filterId ? ' on' : ''}" data-filter="${f.id}">
        <div class="ic">${f.icon || '🎨'}</div>
        <div class="lbl">${f.label}</div>
        ${f.sub ? `<div class="sub">${f.sub}</div>` : ''}
      </div>`).join('');
  };
  renderTiles();
  renderPreviews();

  host.onclick = e => {
    const id = e.target.closest('.filter-option')?.dataset.filter;
    if (!id) return;
    S.filterId = id;
    renderPreviews();
    renderTiles();
  };

  $('#filter-next').onclick = () => finalizeFilterSelection();
};

/* ------------------------------------------------------------- capture */

ON_ENTER.capture = async () => {
  const role = S.cameraAngle || defaultRole();
  // The other camera's stream (if any) closes before this one opens: one at a time.
  if (S.camera && (S.camera.role !== role || !!S.camera.stills !== usesStills(role))) { S.camera.stop('other camera chosen'); S.camera = null; }
  const status = $('#cam-status');
  status.classList.remove('bad');
  const onStatus = s => {
    status.textContent = s.message;
    status.classList.toggle('bad', s.level !== 'ok');
  };
  let cam = (S.camera ||= makeCamera(role));
  cam.onStatus = onStatus;
  showCropGuide(null);

  try {
    try {
      // The camera page already has this camera open: show that stream here
      // rather than closing and reopening it.
      if (cam.isLive) {
        await cam.attach($('#preview'));
        const st = cam.settings;
        onStatus({ level: 'ok', message: `${cam.label} — ${st?.width}x${st?.height} @ ${Math.round(st?.frameRate || 0)}fps` });
      } else await cam.start($('#preview'));
      $('#angle-preview').srcObject = null;
      showCropGuide(cam);
      await cam.verifyLive(1000);
    } catch (error) {
      if (!cam.stills) throw error;
      stillsFallback(error);
      cam.stop('tethered camera failed');
      cam = S.camera = new Camera(S.cfg, role);
      cam.onStatus = onStatus;
      await cam.start($('#preview'));
      await cam.verifyLive(1000);
    }
  } catch (e) {
    S.camera?.stop('preview failed');
    S.camera = null;
    // Say exactly which camera, on screen, and never swap in another one.
    status.textContent = e.message;
    status.classList.add('bad');
    $('#countdown').textContent = '';
    toast(e.message, true);
    clog(`capture: ${e.message}`);
    await sleep(4000);
    if (S.screen !== 'capture') return;
    // Two cameras: back to the choice, where the missing one is greyed out.
    if (cameraAngles().length >= 2 && e.code === 'CAMERA_NOT_FOUND') { go('angle'); return; }
    // Paid but can't shoot — do not strand them. Refund path is in the
    // operator panel; get them off the screen with an explanation.
    go('thanks');
    $('#thanks-sub').textContent = `Sorry — ${e.message}. Find the operator for a refund.`;
    return;
  }

  showCropGuide(cam);
  await runShootSequence();
};

/**
 * Dims everything outside the part of the picture that will be printed:
 * the chosen frame's photo window, centre-cropped with the same coverCrop()
 * the renderer uses (frames/draw.mjs), mapped onto the on-screen preview
 * (object-fit: cover). What the customer sees inside it is what prints.
 */
function showCropGuide(cam) {
  const guide = $('#crop-guide');
  if (!guide) return;
  const v = $('#preview');
  const aspect = photoWindowAspect();
  if (!cam || !aspect || !v.videoWidth) { guide.hidden = true; return; }
  const place = () => {
    const box = v.getBoundingClientRect();
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !box.width) return;
    const shown = coverPlacement(vw, vh, box.width, box.height);
    const crop = coverCrop(vw, vh, aspect, 1);
    // The preview may be mirrored; the crop is centred, so it lands the same either way.
    let x = shown.x + crop.sx * shown.scale, y = shown.y + crop.sy * shown.scale;
    let w = crop.sw * shown.scale, h = crop.sh * shown.scale;
    // Clamp to what's visible (a very wide window on a narrow screen).
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    w = Math.min(box.width, x + w) - x0; h = Math.min(box.height, y + h) - y0; x = x0; y = y0;
    Object.assign(guide.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    guide.hidden = false;
  };
  place();
  clearInterval(showCropGuide._t);
  showCropGuide._t = setInterval(() => (S.screen === 'capture' ? place() : clearInterval(showCropGuide._t)), 500);
}

/** The photo window's width/height for the chosen frame (a strip: one cell). */
function photoWindowAspect() {
  const frame = currentFrame();
  if (!frame) return null;
  const key = `${frame.id}|${frame.template}`;
  if (S._aspectKey === key) return S._aspect;
  const strip = isStrip(frame);
  const { W, H } = printSize(sizeKind(frame), 300);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  let aspect = null;
  try {
    const meta = renderCard(c.getContext('2d'), {
      frame, frameId: frame.id, W, H,
      photo: placeholderPhoto(), photos: strip ? [0, 1, 2, 3].map(() => placeholderPhoto()) : [],
      card: mintCard({ frame, frameId: frame.id, seasonId: S.cfg.collection.seasonId, mint: 1 }),
    });
    const win = meta?.cell || meta?.artWindow;
    if (win?.w && win?.h) aspect = win.w / win.h;
  } catch (e) { clog(`crop guide: ${e.message}`); }
  S._aspectKey = key; S._aspect = aspect;
  return aspect;
}

async function runShootSequence() {
  const c = S.cfg.capture;
  const n = c.shotsPerSession;
  S.shots = [];
  $('#shot-pips').innerHTML = Array.from({ length: n }, () => '<i></i>').join('');

  for (let i = 0; i < n; i++) {
    await countdown(c.countdownSeconds, i === 0 ? 'GET READY' : null);
    if (c.flashScreen) { $('#flash').classList.add('go'); setTimeout(() => $('#flash').classList.remove('go'), 350); }

    S.shots.push(await takeShot(i));
    $$('#shot-pips i')[i]?.classList.add('on');

    // Burst on the last shot only — keeps the session short.
    if (i === n - 1 && c.burst?.enabled && S.product.gif) {
      $('#countdown').textContent = 'HOLD IT';
      S.burst = await S.camera.burst(c.burst);
    }
    if (i < n - 1) await sleep(c.gapBetweenShotsMs);
  }

  $('#countdown').textContent = '';
  S.camera.stop('shoot finished');
  // The filter picker works on the actual shot just taken, so it only makes
  // sense after this point; skip straight to finalizing (with S.filterId
  // untouched, i.e. "Original") when it's off/unconfigured.
  if (filtersEnabled()) go('filter'); else finalizeFilterSelection();
}

/**
 * A real photo from the tethered camera (focus, shutter, flash), or a frame
 * off the video feed. If the camera fails a shot — usually AF not locking —
 * the live view frame stands in, so the session still finishes.
 */
async function takeShot(i) {
  if (!S.camera.shoot) {
    // Only once the video is playing (+300 ms), so the first frame isn't
    // black; a camera that dropped out mid-countdown is retried every 2 s.
    if (!(S.camera.isLive && S.camera.ready)) {
      $('#countdown').textContent = '…';
      await S.camera.waitReady(15000);
      $('#countdown').textContent = '';
    }
    return S.camera.grab();
  }
  $('#countdown').textContent = '📸';
  try {
    return await S.camera.shoot();
  } catch (e) {
    console.error(`[stills] shot ${i + 1}: ${e.message}`);
    toast(`Photo ${i + 1}: ${e.message}`, true);
    return S.camera.grab();
  } finally {
    $('#countdown').textContent = '';
  }
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
      frame: currentFrame(), frameId: S.frameId,
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
      const image = stickerImage(s.id, 96);
      const draw = () => cv.getContext('2d').drawImage(image, 0, 0);
      draw();
      image.ready?.then(draw).catch(() => {});
    });
  };
  fill($('#sticker-buddies'), cat.filter(s => s.kind === 'buddy'));
  fill($('#sticker-decos'), cat.filter(s => s.kind === 'deco'));
  fill($('#sticker-pack'), cat.filter(s => s.kind === 'pack'));

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
    const typedName = S.personal.name.trim();
    const defaultName = currentFrame()?.name || '';
    el.textContent = typedName || defaultName;
    el.classList.toggle('is-empty', !typedName && !defaultName);
    renderNameSuggestions($('#dec-name-suggest'), S.personal.name, name => {
      S.personal.name = name;
      refreshDecName();
    });
    buildSwatches();
    drawDecorate();
  };

  buildKeyboard($('#dec-kb'), {
    max: 18,
    get: () => S.personal.name,
    set: v => { S.personal.name = v; },
    onChange: refreshDecName,
  });

  $('#dec-gen-name').addEventListener('click', async e => {
    const theme = energy(currentFrame()?.energyType)?.name;
    S.personal.name = await surpriseName(e.currentTarget, theme);
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
      // Keys are always uppercase (KB_ROWS) — type it as pressed, don't
      // force every letter but the first of a word to lowercase.
      v += k;
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
    cv.getContext('2d').drawImage(S.filteredShots[i] || shot, 0, 0, cv.width, cv.height);
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
      frame: currentFrame(), frameId: S.frameId,
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
  const f = currentFrame();
  const box = boxFor(f, 500);
  if (cv.width !== box.W || cv.height !== box.H) { cv.width = box.W; cv.height = box.H; }
  const meta = renderCard(cv.getContext('2d'), {
    frame: f, frameId: S.frameId, W: cv.width, H: cv.height,
    ...photoArgs(f),
    character: null,
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

  const frameDef = currentFrame();
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
  const { W, H } = printSize(sizeKind(frameDef), dpi);

  // Do NOT pre-crop here. Cropping the camera frame to the CARD's portrait
  // aspect and then fitting that into a LANDSCAPE art window crops twice — it
  // throws away most of the frame and pushes the subject off-centre. Hand the
  // renderer the full frame and let drawCover fit whatever window the template
  // actually has.
  const heroImg = await canvasToImage(S.filteredShots[S.heroIndex] || S.filteredShots[0]);

  const usesCompanion = ['party', 'kawaii'].includes(frameDef.template);
  S.cardCanvas = document.createElement('canvas');
  S.cardCanvas.width = W; S.cardCanvas.height = H;
  const heroImgs = stripStyle ? await Promise.all(S.filteredShots.map(canvasToImage)) : [];
  renderCard(S.cardCanvas.getContext('2d'), {
    frame: frameDef, frameId: S.frameId, W, H,
    photo: stripStyle ? null : heroImg,
    photos: heroImgs,
    // Pokémon character art is preview-only; the printed/downloaded card
    // keeps the customer's photo clean unless they explicitly add a sticker.
    character: null,
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
    const imgs = await Promise.all(S.filteredShots.map(canvasToImage));
    const stripFrame = currentStripFrame();
    renderStrip(S.stripCanvas.getContext('2d'), {
      W: s.W, H: s.H, photos: imgs, card: S.card, frame: stripFrame,
      // Not personalizationPayload() — it falls back to S.frameId's name when
      // nothing's typed, which is the *card's* frame here, not the strip's
      // own theme (S.stripFrameId). Pass the raw typed name only, so an empty
      // one correctly falls through to the strip theme's own name instead.
      personalization: { name: S.personal.name.trim() },
      stickers: S.stickers, stickerImages: stickerImageMap(),
    });
  }

  if (S.product.gif && S.filteredBurst.length) {
    try { S.gifBlob = await encodeGif(S.filteredBurst, S.cfg.delivery.gif); }
    catch (e) { console.warn('gif encode failed', e); }
  }

  await window.booth.cards.record(S.card);
  // Every session is also kept on this PC (operator panel → Open photos folder),
  // whatever happens with the upload — hosts usually want them all afterwards.
  if (S.cfg.delivery?.saveLocal !== false) saveLocalCopies().catch(e => console.warn('local save failed', e));
  if (S.product.digital && S.cfg.delivery.uploadEnabled) {
    try { await uploadMedia(); }
    catch (e) { console.warn('upload failed', e); }
  }
}

async function sessionFiles() {
  const primaryIsStrip = isStrip(currentFrame());
  const files = [{
    name: isJumbo(currentFrame()) ? 'jumbo-strip.png' : primaryIsStrip ? 'strip.png' : `card-${S.card.serial.replace(/[^\w]+/g, '_')}.png`,
    dataUrl: S.cardCanvas.toDataURL('image/png'),
  }];
  if (S.stripCanvas) files.push({ name: 'strip.png', dataUrl: S.stripCanvas.toDataURL('image/png') });
  S.filteredShots.forEach((c, i) => files.push({ name: `photo-${i + 1}.jpg`, dataUrl: c.toDataURL('image/jpeg', 0.9) }));
  if (S.gifBlob) files.push({ name: 'boomerang.gif', dataUrl: await blobToDataUrl(S.gifBlob) });
  return files;
}

/** One file per item, named by time so a day's sessions sort in order. */
async function saveLocalCopies() {
  const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
  for (const f of await sessionFiles()) await window.booth.media.save({ name: `${stamp}-${f.name}`, dataUrl: f.dataUrl });
}

async function uploadMedia() {
  const files = await sessionFiles();

  const res = await fetch(S.cfg.delivery.uploadUrl, {
    method: 'POST', headers: kioskHeaders(S.cfg.server?.kioskKey),
    body: JSON.stringify({ files, card: S.card, collectorId: null }),
  });
  if (!res.ok) throw new Error(`upload: ${res.status} ${await res.text()}`);
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
  const pfr = currentFrame();
  const named = S.personal.name.trim();
  $('#pull-name').textContent = named ? S.personal.name.trim() : pfr.name;
  $('#pull-serial').textContent = `${pfr.collectorNumber}  ·  ${S.card.serial}`;
  $('#mint-note').textContent = S.card.mintLimit
    ? `Limited edition — only ${S.card.mintLimit} of these will ever be printed.`
    : '';
  $('#btn-retake').hidden = !(S.cfg.capture.allowRetake && S.retakes < S.cfg.capture.maxRetakes);
  $('#btn-print').disabled = !(S.product.prints.card || S.product.prints.strip || S.product.prints.jumbo);
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
  S.shots = []; S.filteredShots = []; S.burst = []; S.filteredBurst = [];
  S.stickers = [];
  // Back to the camera choice (their last pick stays highlighted), so a
  // retake can also be a different angle — not just the same shot again.
  go(cameraAngles().length >= 2 ? 'angle' : 'capture');
}

/* --------------------------------------------------------------- print */

/**
 * Print jobs. Each one is turned into the DNP DS40's native page, 1844 x 1240
 * landscape with the 2-inch cut at y = 620, by toPrinterNative()
 * (src/js/layout.mjs), the only layout rotation in the print path (Windows
 * then gets that page turned once into its driver's frame, toDriverFrame):
 *   cards   two upright 750 x 1050 cards per page, cut by hand → printer.queue4x6 (no cut)
 *   strips  the 620 x 1844 strip turned by rotation.strip, twice → printer.queueStrip (2-inch cut)
 *   jumbo   the 1240 x 1844 page turned by rotation.portrait4x6 → printer.queue4x6
 * Identical pages go as one job with that many copies. The main process
 * saves every page as a PNG before printing it.
 */
function newCanvas({ W, H }) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  return c;
}

function cardJobs(card, count) {
  const per = cardSheetLayout(card.width, card.height).slots.length;
  const jobs = [];
  const full = Math.floor(count / per), rest = count % per;
  if (full) jobs.push({ type: 'cards', canvas: card, count: per, copies: full });
  if (rest) jobs.push({ type: 'cards', canvas: card, count: rest, copies: 1 });
  return jobs;
}

function jumboJobs(jumbo, count) {
  return [{ type: '4x6', canvas: jumbo, copies: Math.max(1, count) }];
}

function stripJobs(strip, count) {
  // Every page carries two strips.
  return [{ type: 'strip', canvas: strip, copies: Math.max(1, Math.ceil(count / 2)) }];
}

/**
 * THE print function. Every print (customer cards, strips, Jumbos and the
 * operator's test prints) goes through here and nowhere else:
 *   1. toPrinterNative(job): the native 1844 x 1240 page (the sheet)
 *   2. the build stamp, bottom right (printer.buildStamp)
 *   3. Windows only: toDriverFrame(), that page turned once by
 *      printer.windowsTurn into the driver's portrait 4x6 frame, which is
 *      what Windows prints, as a portrait job
 *   4. window.booth.printers.print: the main process (electron/main.js
 *      printImage), the Pi kiosk server or the browser preview, which either
 *      print it or, with printer.dryRun on, save the PNG + PDF preview.
 * With dryRun on, the preview panel shows the page and nothing has printed.
 * Strips go to the strip (cut) queue, everything else to the 4x6 queue.
 */
async function sendToPrinter(job, label) {
  const rot = printRotations(S.cfg.printer);
  rot.problems.forEach(p => clog(`print warn: ${p}`));
  const page = toPrinterNative(job, rot, (w, h) => newCanvas({ W: w, H: h }));
  if (page.width !== NATIVE.W || page.height !== NATIVE.H) throw new Error(`The print page is ${page.width}x${page.height}; it must be ${NATIVE.W}x${NATIVE.H}`);
  // Windows: the driver is sent its portrait frame, turned by printer.windowsTurn.
  const target = (await window.booth.app.info().catch(() => ({})))?.printTarget;
  const wt = target === 'windows' ? windowsTurn(S.cfg.printer) : null;
  wt?.problems.forEach(p => clog(`print warn: ${p}`));
  const stamp = buildStampText({ build: await buildInfo(), job, rotation: rot, driverTurn: wt?.turn });
  let out = page;
  if (S.cfg.printer?.buildStamp !== false) {
    // On a copy: toPrinterNative may hand back the job's own canvas (4x6 landscape).
    if (page === job.canvas) { out = newCanvas({ W: page.width, H: page.height }); out.getContext('2d').drawImage(page, 0, 0); }
    drawBuildStamp(out.getContext('2d'), stamp);
  }
  const frame = wt ? toDriverFrame(out, wt.turn, (w, h) => newCanvas({ W: w, H: h })) : null;
  return deliver(out, job, label, rot, stamp, frame && { canvas: frame, turn: wt.turn });
}

let buildInfoCache = null;
async function buildInfo() {
  if (!buildInfoCache) buildInfoCache = (await window.booth.app.info().catch(() => ({})))?.build || {};
  return buildInfoCache;
}

async function deliver(page, job, label, rot, stamp, frame) {
  const kind = job.type === 'strip' ? 'strip' : '4x6';
  const dataUrl = page.toDataURL('image/png');
  const frameUrl = frame ? frame.canvas.toDataURL('image/png') : null;
  const send = (extra = {}) => window.booth.printers.print({ dataUrl, frameUrl, frameTurn: frame?.turn ?? null, kind, copies: job.copies, label, jobType: job.type, ...extra })
    .catch(err => ({ ok: false, reason: err.message }));
  const r = await send();
  const how = job.type === 'strip' ? `strip turned ${rot.strip}°, two copies`
    : job.type === 'cards' ? `${job.count} upright card${job.count > 1 ? 's' : ''}`
    : job.canvas.width === NATIVE.W ? 'not turned' : `turned ${rot.portrait4x6}°`;
  clog(`print ${label} (${job.type}, ${job.canvas.width}x${job.canvas.height}, ${how} → ${page.width}x${page.height}, x${job.copies}, stamp "${stamp}"): ${r.dryRun ? 'PREVIEW ONLY' : r.ok ? 'ok' : `FAILED ${r.reason || ''}`}${r.file ? ` — saved ${r.file}` : ''}${r.paper ? `\n  ${r.paper}` : ''}`);
  (r.notes || []).forEach(n => clog(`print warn: ${n}`));
  if (!r.ok) throw new Error(r.reason || `${label} print was rejected`);
  const result = { ...r, how, stamp, notes: [...rot.problems, ...(r.notes || [])] };
  if (r.dryRun) result.real = await showPrintPreview({ dataUrl, frameUrl, frameTurn: frame?.turn, job, label, r, how, stamp, printOnce: () => send({ copies: 1, force: true }) });
  return result;
}

/**
 * printer.dryRun: the page as the printer would get it, the 2-inch cut
 * (y = 620) dashed for strips and cards, the saved files, and "Looks right —
 * print for real", which sends ONE print of this exact page after a second
 * tap to confirm. Resolves when closed: the real print's result, or null.
 */
function showPrintPreview({ dataUrl, frameUrl = null, frameTurn = null, job, label, r, how, stamp, printOnce }) {
  return new Promise(resolve => {
    const cut = job.type === 'strip' || job.type === 'cards';
    const el = document.createElement('div');
    el.className = 'print-preview';
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(8,8,12,.94);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;color:#fff;font:14px system-ui,sans-serif;text-align:center';
    el.innerHTML = `
      <div style="font-size:20px;font-weight:800;color:#ffcc00">PRINT PREVIEW: nothing was sent to the printer</div>
      <div style="color:#ddd">${escapeHtml(label)} · ${escapeHtml(job.type)} · ${escapeHtml(how)} · 1844 × 1240, 6 × 4 in landscape${cut ? ' · <span style="color:#ff5577">dashed line = 2-inch cut (y = 620)</span>' : ''}</div>
      <div style="display:flex;gap:18px;align-items:center;justify-content:center;max-width:96vw">
        <div style="position:relative;width:min(${frameUrl ? '76vw' : '94vw'},1300px,calc((100vh - 270px) * 1844 / 1240));aspect-ratio:1844/1240;background:#fff;outline:1px solid #777">
          <img src="${dataUrl}" alt="print preview" style="display:block;width:100%;height:100%">
          ${cut ? '<svg viewBox="0 0 1844 1240" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"><line x1="0" y1="620" x2="1844" y2="620" stroke="#ff2d55" stroke-width="4" stroke-dasharray="26 16"/></svg>' : ''}
        </div>
        ${frameUrl ? (r.handoff?.shape === 'sheet'
          ? `<div style="width:min(15vw,220px);color:#bbb;font-size:12px">
          <img src="${dataUrl}" alt="sent as is" style="display:block;width:100%;aspect-ratio:1844/1240;background:#fff;outline:1px solid #777">
          <div style="margin-top:6px">What Windows is sent: this sheet as is, as a portrait job. ${escapeHtml(r.handoff.why)}</div>
        </div>`
          : `<div style="width:min(15vw,220px);color:#bbb;font-size:12px">
          <img src="${frameUrl}" alt="driver frame" style="display:block;width:100%;aspect-ratio:1240/1844;background:#fff;outline:1px solid #777">
          <div style="margin-top:6px">What Windows is sent: the portrait frame, the sheet turned ${escapeHtml(frameTurn)}° (printer.windowsTurn), as a portrait job. ${escapeHtml(r.handoff?.why || '')}</div>
        </div>`) : ''}
      </div>
      <div style="color:#aaa;font-size:12px;white-space:pre-wrap;max-width:94vw;word-break:break-all">${escapeHtml(`stamp: ${stamp}\n${r.png ? `PNG ${r.png}\n` : ''}${r.pdf ? `PDF ${r.pdf}` : ''}${r.driverPdf ? `\nWindows gets ${r.driverPdf}` : ''}`)}</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">
        <button class="btn" data-pp="print">Looks right — print for real</button>
        <button class="btn btn-ghost" data-pp="cancel">Cancel</button>
      </div>
      <div data-pp="status" style="min-height:1.4em;white-space:pre-wrap"></div>`;
    document.body.append(el);
    const status = el.querySelector('[data-pp="status"]');
    const printBtn = el.querySelector('[data-pp="print"]');
    let armed = false, real = null;
    const close = () => { el.remove(); resolve(real); };
    el.querySelector('[data-pp="cancel"]').onclick = close;
    printBtn.onclick = async () => {
      if (!armed) {
        armed = true;
        printBtn.textContent = 'Tap again to send ONE print to the printer';
        status.textContent = 'Preview mode stays on: this sends just this page, once.';
        return;
      }
      printBtn.disabled = true;
      status.textContent = 'Printing…';
      real = await printOnce();
      clog(`print ${label} from the preview: ${real.ok ? 'ok' : `FAILED ${real.reason || ''}`}${real.file ? ` — saved ${real.file}` : ''}${real.paper ? `\n  ${real.paper}` : ''}`);
      status.textContent = real.ok ? `Sent ✓ ${real.paper || ''}` : `Print failed: ${real.reason || ''}`;
      status.style.color = real.ok ? '' : 'var(--bad)';
      printBtn.textContent = real.ok ? 'Sent' : 'Looks right — print for real';
      printBtn.disabled = real.ok;
      armed = false;
    };
  });
}

const PREVIEW_DONE = 'Preview mode: nothing was printed (operator: printer.dryRun).';

async function doPrint() {
  const btn = $('#btn-print');
  btn.disabled = true;
  const st = $('#print-status');
  st.classList.remove('bad');
  let preview = false;
  try {
    // Normally S.cardCanvas holds a card and its count is prints.card. But when
    // the customer's chosen frame is itself a strip style (e.g. the "2 Photo
    // Strips" product), renderCard() draws the strip straight into
    // S.cardCanvas and prints.card is 0 — the print count to use is
    // prints.strip instead, since that's what was actually paid for.
    const cardIsStrip = isStrip(currentFrame());
    if (isJumbo(currentFrame())) {
      const n = S.product.prints.jumbo || S.product.prints.strip || 1;
      st.textContent = `Printing your Jumbo strip${n > 1 ? 's' : ''}…`;
      for (const job of jumboJobs(S.cardCanvas, n)) preview = (await sendToPrinter(job, 'jumbo')).dryRun || preview;
      st.textContent = preview ? PREVIEW_DONE : 'Sent to the printer.';
      await sleep(900);
      go('thanks');
      return;
    }
    const cardCount = cardIsStrip ? S.product.prints.strip : S.product.prints.card;
    if (cardCount) {
      st.textContent = `Printing ${cardCount} ${cardIsStrip ? 'strip' : 'card'}${cardCount > 1 ? 's' : ''}…`;
      for (const job of cardIsStrip ? stripJobs(S.cardCanvas, cardCount) : cardJobs(S.cardCanvas, cardCount)) {
        preview = (await sendToPrinter(job, cardIsStrip ? 'strip' : 'card')).dryRun || preview;
      }
    }
    if (S.product.prints.strip && S.stripCanvas) {
      st.textContent = 'Printing your strip…';
      for (const job of stripJobs(S.stripCanvas, S.product.prints.strip)) preview = (await sendToPrinter(job, 'strip')).dryRun || preview;
    }
    st.textContent = preview ? PREVIEW_DONE : 'Sent to the printer.';
    await sleep(900);
    go('thanks');
  } catch (e) {
    // On screen, with the printer's own reason, so the operator can act on it.
    st.textContent = `Print failed: ${e.message}`;
    st.classList.add('bad');
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
  const { devices, matches: camMatches } = await matchRoles(S.cfg).catch(() => ({ devices: [], matches: {} }));
  const stillsOn = !!(S.cfg.camera?.stills?.enabled && window.booth.stills);

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
      <h3>Cameras</h3>
      ${cameraAngles().map(r => {
        const m = camMatches[r.id];
        return `<div class="kv"><span>${escapeHtml(r.label)} <span style="color:var(--ink-dim)">· ${escapeHtml(r.name)}${r.mode ? ` · ${r.mode}` : ''}</span></span><b style="${m ? '' : 'color:var(--bad)'}">${m ? escapeHtml(m.device.label) : 'not found'}</b></div>`;
      }).join('')}
      <div class="kv"><span>Video devices</span><b>${devices.length}</b></div>
      <div style="display:flex;gap:10px;margin-top:12px">
        <button class="btn btn-ghost" data-go="diagnostics">Camera diagnostics</button>
      </div>
      <p style="color:var(--ink-dim);font-size:13px;margin-top:12px">
        Cameras are matched by name (<code>cameras.standard.labelMatch</code> / <code>cameras.wide.labelMatch</code> in booth.config.json).</p>
    </div>

    <div class="card-panel" style="grid-column:1/-1">
      <h3>Camera log</h3>
      <p style="color:var(--ink-dim);font-size:13px;margin:0 0 8px">Everything the camera did this run. When the preview misbehaves, reproduce it, come back here and copy this.</p>
      <pre id="cam-log" style="max-height:260px;overflow:auto;font-size:11px;line-height:1.35;white-space:pre-wrap;background:rgba(0,0,0,.25);padding:10px;border-radius:8px;margin:0">${escapeHtml(cameraLog.slice(-120).join('\n') || '(nothing yet — open the camera screen first)')}</pre>
      <div style="display:flex;gap:10px;margin-top:10px">
        <button class="btn btn-ghost" id="cam-log-copy">Copy camera log</button>
      </div>
    </div>

    ${stillsOn ? `<div class="card-panel">
      <h3>Photo camera (USB, with flash)</h3>
      <div class="kv"><span>Status</span><b id="stills-status">checking…</b></div>
      <div style="display:flex;gap:10px;margin-top:12px">
        <button class="btn btn-ghost" id="stills-test">Take a test photo</button>
      </div>
      <div class="kv" id="stills-result" hidden></div>
      <img id="stills-img" alt="" hidden style="width:100%;margin-top:10px;border-radius:8px">
    </div>` : ''}

    <div class="card-panel">
      <h3>Printers</h3>
      <div class="kv"><span>Running code</span><b>${escapeHtml(info.build?.commit ? info.build.commit.slice(0, 7) : 'unknown')}${info.build?.packaged ? ' · packaged app' : ''}</b></div>
      <div class="kv"><span style="color:var(--ink-dim);font-size:12px;word-break:break-all">${escapeHtml(`${info.build?.source || ''} · ${info.build?.root || ''} · print code changed ${info.build?.time ? new Date(info.build.time).toLocaleString() : '?'}`)}</span></div>
      ${S.cfg.printer?.dryRun !== false
        ? '<div class="kv"><span><b style="color:#ffcc00">Preview mode ON</b>: nothing is sent to the printer; each page is saved as PNG + PDF and shown on screen.</span><b><button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" data-go="diagnostics">Switch</button></b></div>'
        : '<div class="kv"><span>Preview mode off: prints go to the printer.</span><b><button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" data-go="diagnostics">Switch</button></b></div>'}
      ${printers.length
        ? printers.map(p => {
            const tag = [p.willUse && '4x6', p.willUseStrips && 'STRIPS'].filter(Boolean).join(' + ');
            const btn = (role, label) => `<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;margin-left:6px" data-use-printer="${escapeHtml(p.name)}" data-role="${role}">${label}</button>`;
            return `<div class="kv"><span>${escapeHtml(p.displayName || p.name)}${tag ? ` <b style="color:var(--accent)">· ${tag}</b>` : ''}</span><b>${window.booth.printers.use
              ? `${p.willUse ? '' : btn('cards', '4x6')}${p.willUseStrips ? '' : btn('strips', 'Strips')}`
              : p.isDefault ? 'DEFAULT' : ''}</b></div>`;
          }).join('')
        : '<div class="kv"><span>None detected</span></div>'}
      ${info.platform === 'win32' && printers.some(p => p.willUse) ? `
        <div class="kv"><span>Paper sizes</span><b id="paper-sizes" style="font-weight:400;font-size:12px;text-align:right">loading…</b></div>
        <div class="kv"><span>Print method</span><b>${[['chromium', 'Print page (default)'], ['xps', 'Windows XPS']].map(([m, label]) => {
          const cur = S.cfg.printing?.windowsMethod === 'xps' ? 'xps' : 'chromium';
          return `<button class="btn ${cur === m ? '' : 'btn-ghost'}" style="padding:4px 10px;font-size:12px;margin-left:6px" data-print-method="${m}">${label}</button>`;
        }).join('')}</b></div>` : ''}
      <div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="print-test">Test print 4x6</button>
        <button class="btn btn-ghost" id="print-test-strip">Test print strips</button>
        <button class="btn btn-ghost" id="print-test-cards">Test print cards</button>
        ${window.booth.printers.diagnose ? '<button class="btn btn-ghost" id="print-check">Check printer</button>' : ''}
        <span id="print-test-result" style="font-size:12px;color:var(--ink-dim)"></span>
      </div>
      <div class="kv"><span>4x6 queue</span><b>${escapeHtml(S.cfg.printer?.queue4x6 || '(photo printer, found by name)')}</b></div>
      <div class="kv"><span>Strip queue (2-inch cut)</span><b style="${S.cfg.printer?.queueStrip || info.platform !== 'win32' ? '' : 'color:var(--bad)'}">${escapeHtml(S.cfg.printer?.queueStrip || (info.platform === 'win32' ? 'not set — strips won\'t be cut' : 'same as 4x6'))}</b></div>
      <div class="kv"><span>Finish · copies</span><b>${escapeHtml(S.cfg.printer?.finish || 'glossy')} · ${S.cfg.printer?.copies || 1}</b></div>
      ${printers.length && !printers.some(p => p.willUse) && info.platform === 'win32'
        ? '<p style="color:var(--bad);font-size:13px;margin-top:10px">No photo printer installed — install the DNP driver (see README → Printing on Windows).</p>' : ''}
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
      ${window.booth.payments?.mode ? `<div class="kv"><span>Event mode</span><b>${[['free', 'Free event'], ['reader', 'Card reader + QR'], ['qr', 'QR only']].map(([m, label]) => {
        const prov = S.cfg.payments.realProvider || S.cfg.payments.provider;
        const cur = prov === 'free' ? 'free' : prov === 'stripe-qr' ? 'qr' : 'reader';
        return `<button class="btn ${cur === m ? '' : 'btn-ghost'}" style="padding:4px 10px;font-size:12px;margin-left:6px" data-event-mode="${m}">${label}</button>`;
      }).join('')}</b></div>` : ''}
      ${window.booth.media?.openFolder ? '<div class="kv"><span>Photos</span><b><button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" id="open-photos">Open photos folder</button></b></div>' : ''}
      <div class="kv"><span>Payments</span><b>${S.cfg.payments.provider === 'mock'
        ? `TEST (mock)${S.cfg.payments.realProvider ? ` — npm start uses ${S.cfg.payments.realProvider}` : ''}`
        : S.cfg.payments.provider}</b></div>
      <div class="kv"><span>Version</span><b>${info.version} · ${info.platform}</b></div>
      <div class="kv"><span>Bridge</span><b>${S.platform}</b></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn btn-ghost" id="admin-reload">Reload app</button>
        <button class="btn btn-ghost" id="admin-quit">Quit</button>
      </div>
    </div>`;

  if (stillsOn) {
    // Status and a test shot, so focus and flash can be checked before the doors open.
    window.booth.stills.status().then(st => {
      const el = $('#stills-status');
      if (el) { el.textContent = st.ok ? st.message : st.error; el.style.color = st.ok ? '' : 'var(--bad)'; }
    });
    $('#stills-test')?.addEventListener('click', async e => {
      const btn = e.currentTarget, out = $('#stills-result'), img = $('#stills-img');
      btn.disabled = true; out.hidden = false; out.textContent = 'Focusing and shooting…';
      const t0 = performance.now();
      const r = await window.booth.stills.capture().catch(err => ({ ok: false, error: err.message }));
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      if (r.ok) {
        img.src = `data:image/jpeg;base64,${r.jpeg}`;
        img.hidden = false;
        img.onload = () => { out.textContent = `${img.naturalWidth}×${img.naturalHeight} in ${secs}s — saved to ${r.file}`; };
      } else {
        out.textContent = `Failed after ${secs}s: ${r.error}`;
        out.style.color = 'var(--bad)';
      }
      btn.disabled = false;
    });
  }

  window.booth.printers.papers?.().then(r => {
    const el = $('#paper-sizes');
    if (el) el.textContent = r.ok ? r.sizes.map(s => `${s.name} (${s.widthIn}×${s.heightIn})`).join(' · ') || 'none' : r.error;
  });

  $$('[data-print-method]').forEach(b => b.addEventListener('click', async () => {
    const r = await window.booth.printers.method?.(b.dataset.printMethod).catch(e => ({ ok: false, error: e.message }));
    if (!r?.ok) { toast(r?.error || 'Could not change the print method', true); return; }
    S.cfg = r.config;
    ON_ENTER.admin();
  }));

  // Calibration test prints (layout.mjs drawCalibration): each built in its
  // design orientation, then through toPrinterNative like a real job.
  const printTest = async (e, job) => {
    const btn = e.currentTarget, out = $('#print-test-result');
    btn.disabled = true; out.textContent = 'Printing…'; out.style.color = '';
    const d = CALIBRATION_DESIGN[job];
    const c = newCanvas(d);
    const rot = printRotations(S.cfg.printer);
    drawCalibration(c.getContext('2d'), { job, rotation: d.rotationKey ? rot[d.rotationKey] : null, label: new Date().toLocaleString() });
    try {
      const r = await sendToPrinter({ type: job, canvas: c, count: 2, copies: 1 }, `test-${job}`);
      out.style.whiteSpace = 'pre-wrap';
      out.textContent = `${r.dryRun ? (r.real?.ok ? 'Preview, then sent ✓' : 'Preview only (printer.dryRun), nothing printed:') : 'Sent ✓'} ${d.W}x${d.H} design, ${r.how} → ${NATIVE.W}x${NATIVE.H} — stamp "${r.stamp}" — saved ${r.file || ''}${(r.notes || []).map(n => `\n⚠ ${n}`).join('')}\n${r.paper || ''}`;
    } catch (err) {
      out.textContent = `Failed: ${err.message}`;
      out.style.color = 'var(--bad)';
    }
    btn.disabled = false;
  };
  $('#print-check')?.addEventListener('click', async e => {
    const btn = e.currentTarget, out = $('#print-test-result');
    btn.disabled = true; out.textContent = 'Asking Windows…';
    const r = await window.booth.printers.diagnose().catch(err => ({ ok: false, text: err.message }));
    clog(`printer check:\n${r.text}`);
    out.style.whiteSpace = 'pre-wrap';
    out.textContent = r.text;
    btn.disabled = false;
  });
  $('#print-test')?.addEventListener('click', e => printTest(e, '4x6'));
  $('#print-test-strip')?.addEventListener('click', e => printTest(e, 'strip'));
  $('#print-test-cards')?.addEventListener('click', e => printTest(e, 'cards'));

  $$('[data-use-printer]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const r = await window.booth.printers.use(b.dataset.usePrinter, b.dataset.role).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) { toast(r.error, true); b.disabled = false; return; }
    S.cfg = r.config;
    toast(`${b.dataset.role === 'strips' ? 'Strips' : '4x6 prints'} go to ${b.dataset.usePrinter}`);
    ON_ENTER.admin();
  }));

  $('#cam-log-copy')?.addEventListener('click', async e => {
    const btn = e.currentTarget; // null once the await below returns
    const text = cameraLog.join('\n');
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied ✓ — paste it to support'; }
    catch {
      // Clipboard blocked: select the text so Ctrl+C works.
      const r = document.createRange(); r.selectNodeContents($('#cam-log'));
      getSelection().removeAllRanges(); getSelection().addRange(r);
      btn.textContent = 'Selected — press Ctrl+C';
    }
  });

  $$('[data-event-mode]').forEach(b => b.addEventListener('click', async () => {
    const r = await window.booth.payments.mode(b.dataset.eventMode).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) { toast(r.error, true); return; }
    toast('Event mode saved — restarting the booth screen');
    setTimeout(() => window.booth.app.reload(), 900);
  }));
  $('#open-photos')?.addEventListener('click', async () => {
    const r = await window.booth.media.openFolder().catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) toast(r.error || 'Could not open the folder', true);
  });

  $$('#admin-body [data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  $('#admin-reload')?.addEventListener('click', () => window.booth.app.reload());
  $('#admin-quit')?.addEventListener('click', () => window.booth.app.quit());
};

/* ---------------------------------------------------------- diagnostics */

/**
 * Hidden screen (operator panel → Camera diagnostics, or Ctrl+Shift+D):
 * every video device's label and deviceId, which one each role matched, and
 * the resolution each camera really streams at. The cameras are opened one
 * after the other, never together.
 */
/**
 * Preview mode (printer.dryRun) switch, on the diagnostics screen: saved to
 * this PC's booth.config.local.json, no file editing.
 */
function renderPreviewToggle() {
  let box = $('#diag-print-mode');
  if (!box) {
    box = document.createElement('div');
    box.id = 'diag-print-mode';
    box.style.cssText = 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 14px;margin:0 0 12px;border-radius:10px;background:rgba(255,255,255,.06)';
    $('#diag-body').before(box);
  }
  const on = S.cfg.printer?.dryRun !== false;
  const turn = windowsTurn(S.cfg.printer).turn;
  box.innerHTML = `<b>Print preview mode (printer.dryRun):</b>
    <span style="color:${on ? '#ffcc00' : 'var(--ink-dim)'}">${on ? 'ON: nothing is sent to the printer; pages are saved as PNG + PDF and shown on screen' : 'OFF: prints go to the printer'}</span>
    <button class="btn btn-ghost" id="diag-dryrun" style="padding:6px 14px">${on ? 'Turn preview mode OFF (print for real)' : 'Turn preview mode ON'}</button>
    ${window.booth.printers.windowsTurn ? `<span style="flex-basis:100%;height:0"></span>
    <b>Windows print direction (printer.windowsTurn):</b> <span>${turn}°</span>
    <button class="btn btn-ghost" id="diag-wturn" style="padding:6px 14px">Flip to ${turn === 270 ? 90 : 270}° (if prints come out upside down)</button>` : ''}`;
  if (window.booth.printers.papers && window.booth.printers.windowsTurn) {
    const info = document.createElement('div');
    info.id = 'diag-paper';
    info.style.cssText = 'flex-basis:100%;font-size:13px;color:var(--ink-dim);white-space:pre-wrap';
    info.textContent = 'Reading the DS40 queues\' paper…';
    box.append(info);
    window.booth.printers.papers().then(p => {
      info.textContent = (p.queues || []).map(q => q.error && !q.current
        ? `${q.role}: ${q.printer ? `"${q.printer}" ` : ''}${q.error}`
        : `${q.role}: "${q.printer}" paper ${q.current.name} ${q.current.widthIn} x ${q.current.heightIn} in${q.current.landscape ? ', Landscape' : ', Portrait'} in Printing Preferences → ${q.handoff.shape === 'sheet' ? 'the app sends the sheet as is' : `the app sends the portrait frame (turned ${turn}°)`}, as a portrait job`).join('\n') || (p.error || 'no answer');
    }).catch(e => { info.textContent = `Couldn't read the paper: ${e.message}`; });
  }
  const flip = $('#diag-wturn');
  if (flip) flip.onclick = async () => {
    const r = await window.booth.printers.windowsTurn(turn === 270 ? 90 : 270).catch(e => ({ ok: false, error: e.message }));
    if (r?.config) S.cfg = r.config;
    renderPreviewToggle();
  };
  $('#diag-dryrun').onclick = async () => {
    const r = await window.booth.printers.dryRun?.(!on).catch(e => ({ ok: false, error: e.message }));
    if (r?.config) S.cfg = r.config;
    else if (r?.ok) S.cfg.printer = { ...(S.cfg.printer || {}), dryRun: !on };
    renderPreviewToggle();
  };
}

ON_ENTER.diagnostics = async () => {
  S.camera?.stop('diagnostics');
  S.camera = null;
  stopActiveCamera();
  const body = $('#diag-body');
  const video = $('#diag-video');
  const token = S.diagToken = {};
  const alive = () => S.diagToken === token && S.screen === 'diagnostics';
  body.innerHTML = '<p>Listing cameras…</p>';
  $('#diag-refresh').onclick = () => ON_ENTER.diagnostics();
  renderPreviewToggle();
  let devices = [], matches = {};
  try { ({ devices, matches } = await matchRoles(S.cfg)); } catch (e) {
    body.innerHTML = `<p style="color:var(--bad)">${escapeHtml(e.message)}</p>`;
    return;
  }
  const roles = cameraAngles();
  const results = {};
  const roleOf = id => roles.filter(r => matches[r.id]?.device.deviceId === id).map(r => r.label).join(', ');
  const render = () => {
    body.innerHTML = `
      <h3>Video devices (${devices.length})</h3>
      <table>
        <tr><th>Label</th><th>deviceId</th><th>Role</th></tr>
        ${devices.map(d => `<tr><td>${escapeHtml(d.label || '(no label)')}</td><td><code>${escapeHtml(d.deviceId)}</code></td><td>${escapeHtml(roleOf(d.deviceId) || '—')}</td></tr>`).join('') || '<tr><td colspan="3">None</td></tr>'}
      </table>
      <h3>Roles</h3>
      <table>
        <tr><th>Role</th><th>Looks for (label contains)</th><th>Matched</th><th>Stream</th></tr>
        ${roles.map(r => {
          const m = matches[r.id], res = results[r.id];
          return `<tr>
            <td><b>${escapeHtml(r.label)}</b><br><span style="color:var(--ink-dim)">${escapeHtml(r.name)}${r.mode ? ` · mode ${escapeHtml(r.mode)}` : ''}</span></td>
            <td>${r.match.map(escapeHtml).join(', ')}${r.deviceLabel ? `<br><span style="color:var(--ink-dim)">saved: ${escapeHtml(r.deviceLabel)}</span>` : ''}</td>
            <td>${m ? `${escapeHtml(m.device.label)}<br><span style="color:var(--ink-dim)">${escapeHtml(m.how)}</span>` : '<b style="color:var(--bad)">not found</b>'}</td>
            <td>${res ? escapeHtml(res) : m ? 'testing…' : '—'}</td></tr>`;
        }).join('')}
      </table>`;
  };
  render();
  for (const r of roles) {
    if (!matches[r.id] || !alive()) continue;
    const cam = new Camera(S.cfg, r.id);
    try {
      const st = await cam.start(video);
      results[r.id] = `asked ${r.width}x${r.height}@${r.frameRate} → got ${st.width}x${st.height} @ ${Math.round(st.frameRate || 0)} fps · video ${video.videoWidth}x${video.videoHeight}${cam.ready ? '' : ' · NOT playing'}${r.mirrorPreview ? ' · preview mirrored' : ''}`;
      await sleep(2000); // long enough to see the picture
    } catch (e) {
      results[r.id] = `failed: ${e.message}`;
    } finally {
      cam.stop('diagnostics: next camera');
    }
    clog(`diagnostics: ${r.id}: ${results[r.id]}`);
    if (alive()) render();
  }
  if (alive()) video.srcObject = null;
};

/* --------------------------------------------------------------- utils */

const escapeHtml = str => String(str).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

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
