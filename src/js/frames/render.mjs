/**
 * render.mjs — the single entry point everything else calls.
 *
 * renderCard() is deliberately synchronous and canvas-agnostic: hand it any
 * 2D context (browser canvas, OffscreenCanvas, node-canvas) plus a frame, a
 * photo and some meta, and it draws a finished card. The kiosk preview, the
 * print master and the gallery all go through this one function, which is why
 * what the customer sees on screen is what comes out of the printer.
 */

import { TEMPLATES } from './templates.mjs';
import { frameById, isAvailable, SET } from './packs.mjs';
import { applyFoil, rollRarity, makeSerial, rarityMeta, seededRng, hashString } from './rarity.mjs';
import { roundRect, alpha, font } from './draw.mjs';
import { companionById } from './companions.mjs';
import { drawStickers } from './stickers.mjs';

export const CARD_ASPECT = 2.5 / 3.5;
export const STRIP_ASPECT = 2 / 6;

/**
 * Physical sizes. The prop board keeps the card's 5:7 aspect rather than
 * filling a 24x36 sheet, because a card-shaped board is the point — it trims
 * from standard 24x36 foam board with 2.4in of waste at one end.
 */
export const SIZES = {
  card:  { widthIn: 2.5,  heightIn: 3.5,  dpi: 300 },
  strip: { widthIn: 2.0,  heightIn: 6.0,  dpi: 300 },
  board: { widthIn: 24,   heightIn: 33.6, dpi: 150 },
};

export function printSize(kind, dpi) {
  const s = SIZES[kind] || SIZES.card;
  const d = dpi || s.dpi;
  return { W: Math.round(s.widthIn * d), H: Math.round(s.heightIn * d), widthIn: s.widthIn, heightIn: s.heightIn, dpi: d };
}

/* ----------------------------------------------------------- token fill */

const TOKEN = /\{\{(\w+)\}\}/g;

function fillTokens(value, tokens) {
  if (typeof value === 'string') return value.replace(TOKEN, (_, k) => (k in tokens ? tokens[k] : `{{${k}}}`));
  if (Array.isArray(value)) return value.map(v => fillTokens(v, tokens));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = fillTokens(value[k], tokens);
    return out;
  }
  return value;
}

/** Stats are derived from the serial, so a given card always has the same numbers. */
export function deriveTokens(seed) {
  const rng = seededRng(seed);
  const pick = (min, max, step = 1) => min + Math.floor(rng() * ((max - min) / step + 1)) * step;
  return {
    atk: pick(800, 3000, 50),
    def: pick(600, 2800, 50),
    pow: pick(1, 8),
    tou: pick(1, 8),
    hp: pick(60, 180, 10),
    score: String(pick(10000, 999999)).padStart(6, '0'),
    combo: pick(3, 99),
    rank: ['S', 'A', 'B', 'C', 'SS'][pick(0, 4)],
    friend: ['MAX', '99', '∞', 'BFF'][pick(0, 3)],
    seconds: String(pick(10, 59)).padStart(2, '0'),
  };
}

/* ------------------------------------------------------- personalisation */

const ORDINALS = ['th', 'st', 'nd', 'rd'];
export function ordinal(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const r = v % 100;
  return v + (ORDINALS[(r - 20) % 10] || ORDINALS[r] || ORDINALS[0]);
}

function possessive(name) {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/** Hard cap on a customer-typed name, independent of whatever the on-screen
 *  keyboard already limits to — so a name arriving from any other input path
 *  (an asset-pack value, a future API) can never overflow a card's layout. */
const MAX_NAME_LENGTH = 24;

/**
 * Fill in everything the party template needs from the little the customer
 * actually typed. They enter a name and an age on a touchscreen; everything
 * else — the headline, the thank-you line, even the HP — is derived, because
 * asking a parent at a party to fill in eight fields is how you lose the queue.
 *
 * Every card template reads `name` here rather than its own species/frame
 * name, so a customer's typed name always wins — and when nobody typed one,
 * every template shows the same sensible fallback instead of each falling
 * back to its own frame name.
 */
export function buildPersonal(input = {}, companionSpec = null) {
  const trimmed = String(input.name || '').trim();
  const provided = !!trimmed;
  const name = (trimmed || 'Friend').slice(0, MAX_NAME_LENGTH);
  const ageRaw = input.age;
  const age = ageRaw === '' || ageRaw == null ? null : Number(ageRaw);
  const hasAge = Number.isFinite(age);

  return {
    provided,
    name,
    age: hasAge ? age : null,
    ageLabel: hasAge ? `AGE ${age}` : 'PARTY',
    // HP scales with age — a small joke that lands every time with kids.
    hp: input.hp ?? (hasAge ? Math.max(60, Math.min(340, 60 + age * 10)) : 100),
    headline: input.headline || (hasAge ? `${name} is ${age} years old!` : `Happy day, ${name}!`),
    thanks: input.thanks || (hasAge
      ? `Thank you for celebrating ${possessive(name)} ${ordinal(age)} birthday!`
      : `Thank you for celebrating with ${name}!`),
    ribbon: input.ribbon || 'Party Guest',
    companionId: companionSpec?.id || input.companionId || null,
    companionName: companionSpec?.name || null,
  };
}

/* -------------------------------------------------------------- session */

/**
 * Build the immutable record of one printed card. Persist this — it is what
 * the dex, reprints and the "collect them all" progress bar all read from.
 */
export function mintCard({
  frame: frameObj = null,
  frameId,
  seasonId = 'S1-2026',
  mint = 1,
  boothId = 'BOOTH-001',
  boothName = 'HOLOBOOTH',
  collectorId = null,
  product = {},
  now = new Date(),
  forcedRarity = null,
}) {
  const frame = frameObj || frameById(frameId);
  if (!frame) throw new Error(`Unknown frame: ${frameId}`);

  const mintLimit = frame.availability?.mintLimit || null;
  const serial = makeSerial({ seasonId, frameId, mint, mintLimit });
  const seed = hashString(`${seasonId}|${frameId}|${mint}|${boothId}`);

  const rarity = forcedRarity || rollRarity({
    boost: product.rarityBoost || 1,
    floor: frame.rarityFloor || null,
    guarantee: product.guaranteeAtLeast || null,
    rng: seededRng(seed),
  });

  return {
    frameId,
    packId: frame.packId,
    soldOut: !!(mintLimit && mint > mintLimit),
    seasonId,
    mint,
    mintLimit,
    serial,
    seed,
    boothId,
    boothName,
    collectorId,
    limited: !!frame.limited,
    available: isAvailable(frame, now),
    mintedAt: now.toISOString(),
    ...rarityMeta(rarity),
  };
}

/* --------------------------------------------------------------- render */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} opts
 * @param {string} opts.frameId
 * @param {number} opts.W  @param {number} opts.H
 * @param {Image}  opts.photo        primary hero photo
 * @param {Image[]} opts.photos      all session shots (strip template)
 * @param {Image}  opts.character    optional hand-drawn drop sticker
 * @param {object} opts.card         result of mintCard()
 * @param {boolean} opts.foil        draw the foil pass (off for on-screen picker thumbs)
 */
export function renderCard(ctx, opts) {
  const {
    frameId, W, H, photo = null, photos = [], character = null,
    card, foil = true, focal = { x: 0.5, y: 0.45 }, watermark = null,
    personalization = null, companion = null, stock = null,
    stickers = null, stickerImages = null,
  } = opts;

  const base = opts.frame || frameById(frameId);
  if (!base) throw new Error(`Unknown frame: ${frameId}`);

  const companionSpec = personalization?.companionId ? companionById(personalization.companionId) : null;
  // Asset-pack frames take personalisation too — a licensed party card is
  // still a party card, and its manifest can reference {{name}} and {{age}}.
  const personal = buildPersonal(personalization || {}, companionSpec);

  // Personal fields join the derived stats as tokens, so party copy can say
  // "{{name}}" and a card written a year ago still fills in correctly.
  const tokens = {
    ...deriveTokens(card?.seed ?? 1),
    // Only substitute a customer name into copy once they have actually typed
    // one; otherwise a card's own written attack text would say "Friend".
    ...(personal.provided
      ? { name: personal.name, age: personal.age ?? '', companion: personal.companionName || '' }
      : { name: base.name, age: '', companion: personal.companionName || '' }),
  };
  const frame = { ...base, content: fillTokens(base.content || {}, tokens), theme: base.theme };

  const meta = {
    ...(card || {}),
    focal,
    dateLabel: new Date(card?.mintedAt || Date.now()).toLocaleDateString('en-US',
      { month: 'short', day: 'numeric', year: 'numeric' }),
    mintLabel: card?.mintLimit ? `LIMITED · ${card.serial}` : null,
    setName: SET.name.replace(/ —.*/, ''),
    setId: SET.id,
    collectorNumber: base.collectorNumber || null,
    rarityLabel: card?.rarityLabel || 'Common',
    raritySymbol: card?.raritySymbol || '●',
    rarityColor: card?.rarityColor || '#8b93a1',
    serial: card?.serial || '—',
    seasonId: card?.seasonId || 'S1',
    boothName: card?.boothName || 'HOLOBOOTH',
    personal,
    approvalMode: !!opts.approvalMode,
    packValues: opts.packValues || null,
  };

  ctx.save();
  ctx.clearRect(0, 0, W, H);
  const draw = TEMPLATES[frame.template] || TEMPLATES.creature;
  draw(ctx, { W, H, frame, photo, photos, character, companion, meta, stock });
  ctx.restore();

  // Stickers go on after the frame draws, because the template is what tells us
  // where the photo window actually is.
  if (stickers?.length && stickerImages && meta.artWindow) {
    drawStickers(ctx, stickers, meta.artWindow, stickerImages);
  }

  if (foil && card?.rarity) applyFoil(ctx, W, H, card.rarity, card.seed);

  if (watermark) drawWatermark(ctx, W, H, watermark);
  return meta;
}

function drawWatermark(ctx, W, H, text) {
  ctx.save();
  roundRect(ctx, 0, 0, W, H, W * 0.05);
  ctx.clip();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#fff';
  ctx.font = font(800, W * 0.075, 'Helvetica, Arial, sans-serif');
  ctx.textAlign = 'center';
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-0.55);
  for (let i = -2; i <= 2; i++) ctx.fillText(text, 0, i * W * 0.19);
  ctx.restore();
}

/**
 * The oversized photo-prop board: the same card, printed big, with the art
 * window marked for cutting so guests stand behind it and their head fills the
 * frame. This is the thing people actually hold up at a party — the printed
 * card is the keepsake, the board is the photo op.
 *
 * Everything below the cut line is drawn normally, so the board carries the
 * same name, age and mascot as the cards from that event.
 */
export function renderPropBoard(ctx, opts) {
  const { W, H } = opts;
  const meta = renderCard(ctx, { ...opts, photo: null, foil: false });

  // Templates report their real art-window rect, so the cut line lands exactly
  // on the frame rather than a guess at where it probably is.
  const win = meta.artWindow || { x: W * 0.10, y: H * 0.19, w: W * 0.80, h: H * 0.355 };

  ctx.save();
  // Leave the cut area unprinted. A knocked-out hole would come out solid black
  // once the board is flattened to JPEG for the printer.
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, win.x, win.y, win.w, win.h, W * 0.012);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(20,20,25,.75)';
  ctx.lineWidth = Math.max(2, W * 0.0035);
  ctx.setLineDash([W * 0.014, W * 0.010]);
  roundRect(ctx, win.x, win.y, win.w, win.h, W * 0.012);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(20,20,25,.62)';
  ctx.font = font(700, W * 0.022, 'Nunito, system-ui, sans-serif');
  ctx.textAlign = 'center';
  ctx.fillText('CUT OUT THIS WINDOW', W / 2, win.y + win.h / 2);
  ctx.font = font(500, W * 0.014, 'Nunito, system-ui, sans-serif');
  ctx.fillText('stand behind the board so your face fills the frame', W / 2, win.y + win.h / 2 + W * 0.030);

  // Crop marks at the board corners.
  const cm = W * 0.020, off = W * 0.010;
  ctx.strokeStyle = 'rgba(20,20,25,.55)';
  ctx.lineWidth = Math.max(1, W * 0.0015);
  [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]].forEach(([x, y, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(x + sx * off, y); ctx.lineTo(x + sx * (off + cm), y);
    ctx.moveTo(x, y + sy * off); ctx.lineTo(x, y + sy * (off + cm));
    ctx.stroke();
  });
  ctx.restore();

  return meta;
}

/** Renders a strip. photos should be the session's shots in order. */
export function renderStrip(ctx, { W, H, photos, card, theme = null }) {
  const frame = {
    template: 'strip',
    name: 'strip',
    theme: theme || {
      border: '#12141a', borderEdge: '#5a6172', plateText: '#f2f4f8',
      fontDisplay: 'Rajdhani, Impact, sans-serif', fontBody: 'Helvetica, Arial, sans-serif',
    },
  };
  const meta = {
    ...card,
    focal: { x: 0.5, y: 0.4 },
    dateLabel: new Date(card?.mintedAt || Date.now()).toLocaleDateString('en-US',
      { month: 'short', day: 'numeric', year: 'numeric' }),
    serial: card?.serial || '—',
    boothName: card?.boothName || 'HOLOBOOTH',
  };
  ctx.clearRect(0, 0, W, H);
  TEMPLATES.strip(ctx, { W, H, frame, photos, meta });
  return meta;
}
