/**
 * assetpack.mjs — render cards from artwork somebody else supplies.
 *
 * WHY THIS EXISTS
 * The drawn templates in this repo are original art generated in code. If you
 * hold a licence to a property, the licensor gives you the actual assets — the
 * frame artwork, the character art, the symbols, the fonts — plus a style guide
 * saying exactly how they may be composed. You do not redraw their frame; you
 * composite into the files they handed you.
 *
 * So an asset pack is: a folder of images the licensor supplied, plus a
 * manifest saying where the photo goes and where each piece of text sits. This
 * module turns that into a printed card. It is deliberately property-agnostic —
 * the same pipeline serves a licensed character brand, a sports team, a
 * corporate client, or your own commissioned artwork.
 *
 *   packs/<pack-id>/
 *     pack.json          the manifest (schema below)
 *     LICENSE.txt        your actual grant — the booth surfaces it to operators
 *     frames/*.png       frame art, transparent where the photo shows through
 *     characters/*.png   character art
 *     symbols/*.png      type / energy symbols
 *     fonts/*.woff2      licensed fonts
 *
 * All manifest coordinates are normalised 0..1 against card width/height, so a
 * pack authored once renders correctly at a 360px picker thumbnail and a
 * 750x1050 300dpi print master.
 */

import { roundRect, alpha, font, fitText, paragraph, drawCover, clipped } from './draw.mjs';

export const PACK_SCHEMA_VERSION = 1;

/* ============================================================== validation */

const REQUIRED_FRAME_KEYS = ['id', 'name', 'art', 'photoWindow'];

/**
 * Check a manifest before it ever reaches a printer. Returns errors (the pack
 * will not render) and warnings (it will, but somebody should look).
 */
export function validateManifest(m, { assetExists = () => true } = {}) {
  const errors = [];
  const warnings = [];
  const E = s => errors.push(s);
  const W = s => warnings.push(s);

  if (!m || typeof m !== 'object') return { errors: ['pack.json is not an object'], warnings };
  if (!m.id) E('pack.json: "id" is required');
  if (!m.name) E('pack.json: "name" is required');
  if (m.schema && m.schema > PACK_SCHEMA_VERSION) {
    E(`pack.json: schema ${m.schema} is newer than this build understands (${PACK_SCHEMA_VERSION})`);
  }

  // Licensing metadata is not decoration. If you are compositing somebody
  // else's artwork, the booth should be able to say whose and under what.
  if (!m.licensor?.name) W('pack.json: no licensor.name — set it so operators can see whose artwork this is');
  if (!m.attribution) W('pack.json: no attribution line — most licences require one printed on the card');
  if (!assetExists('LICENSE.txt')) W('no LICENSE.txt in the pack — keep your grant with the assets');

  if (!Array.isArray(m.frames) || !m.frames.length) {
    E('pack.json: "frames" must be a non-empty array');
    return { errors, warnings };
  }

  const seen = new Set();
  m.frames.forEach((f, i) => {
    const at = `frames[${i}]${f.id ? ` (${f.id})` : ''}`;
    for (const k of REQUIRED_FRAME_KEYS) if (f[k] == null) E(`${at}: missing "${k}"`);
    if (f.id) {
      if (seen.has(f.id)) E(`${at}: duplicate frame id`);
      seen.add(f.id);
    }
    if (f.art && !assetExists(f.art)) E(`${at}: art file not found: ${f.art}`);

    const pw = f.photoWindow;
    if (pw) {
      for (const k of ['x', 'y', 'w', 'h']) {
        if (typeof pw[k] !== 'number') E(`${at}: photoWindow.${k} must be a number`);
      }
      if (pw.x < 0 || pw.y < 0 || pw.x + pw.w > 1.0001 || pw.y + pw.h > 1.0001) {
        E(`${at}: photoWindow falls outside the card (coordinates are 0..1 fractions)`);
      }
      if (pw.w < 0.15 || pw.h < 0.1) W(`${at}: photoWindow is very small — is it in fractions, not pixels?`);
    }

    (f.text || []).forEach((t, j) => {
      if (t.value == null) E(`${at}.text[${j}]: missing "value"`);
      if (typeof t.x !== 'number' || typeof t.y !== 'number') E(`${at}.text[${j}]: x and y are required numbers`);
      if (t.font && !(m.fonts || []).some(ft => ft.family === t.font)) {
        W(`${at}.text[${j}]: font "${t.font}" is not declared in pack.fonts — it will fall back`);
      }
    });

    (f.symbolSlots || []).forEach((sl, j) => {
      if (sl.symbol && !(m.symbols || {})[sl.symbol]) {
        E(`${at}.symbolSlots[${j}]: symbol "${sl.symbol}" is not in pack.symbols`);
      }
    });
  });

  return { errors, warnings };
}

/** Every asset path a pack references, for preloading and for the validator. */
export function packAssets(m) {
  const out = new Set();
  for (const f of m.frames || []) {
    if (f.art) out.add(f.art);
    if (f.underlay) out.add(f.underlay);
    if (f.back) out.add(f.back);
    for (const sl of f.symbolSlots || []) {
      const src = sl.image || (m.symbols || {})[sl.symbol];
      if (src) out.add(src);
    }
    for (const ch of f.characterSlots || []) if (ch.image) out.add(ch.image);
  }
  for (const src of Object.values(m.symbols || {})) out.add(src);
  for (const ft of m.fonts || []) out.add(ft.file);
  return [...out];
}

/* ================================================================ tokens */

/** Resolve {{a.b.c}} against a values object. Missing paths render empty. */
export function fillValue(template, values) {
  return String(template).replace(/\{\{([\w.]+)\}\}/g, (_, path) => {
    const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), values);
    return v == null ? '' : String(v);
  });
}

/* ================================================================ render */

/**
 * Composite one card from a pack.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o
 * @param {number} o.W @param {number} o.H     card pixel size
 * @param {object} o.pack                      the manifest
 * @param {object} o.frame                     one entry from pack.frames
 * @param {object} o.images                    { [assetPath]: Image }
 * @param {Image}  o.photo
 * @param {object} o.values                    token values (name, hp, serial…)
 * @param {boolean} o.approval                 stamp it FOR APPROVAL
 */
export function drawAssetCard(ctx, o) {
  const { W, H, pack, frame, images = {}, photo, values = {}, approval = false } = o;
  const px = f => f * W;
  const py = f => f * H;

  ctx.save();
  ctx.clearRect(0, 0, W, H);

  // Card ground. Licensed frame art is usually transparent at the photo window
  // and opaque elsewhere, but a pack can also supply a separate underlay.
  ctx.fillStyle = frame.background || pack.background || '#ffffff';
  clipped(ctx, c => roundRect(c, 0, 0, W, H, W * (frame.corner ?? pack.corner ?? 0.048)),
    c => c.fillRect(0, 0, W, H));

  const underlay = images[frame.underlay];
  if (underlay) ctx.drawImage(underlay, 0, 0, W, H);

  /* ---- photo, beneath the frame art */
  const pw = frame.photoWindow;
  if (photo && pw) {
    const x = px(pw.x), y = py(pw.y), w = px(pw.w), h = py(pw.h);
    clipped(ctx,
      c => roundRect(c, x, y, w, h, px(pw.corner ?? 0)),
      c => drawCover(c, photo, x, y, w, h, frame.photoFocal || { x: 0.5, y: 0.4 }));
  }

  /* ---- the supplied frame artwork, over the photo */
  const art = images[frame.art];
  if (art) {
    clipped(ctx, c => roundRect(c, 0, 0, W, H, W * (frame.corner ?? pack.corner ?? 0.048)),
      c => c.drawImage(art, 0, 0, W, H));
  }

  /* ---- character art the operator or customer picked */
  for (const slot of frame.characterSlots || []) {
    const img = images[values[`character:${slot.id}`] || slot.image];
    if (!img) continue;
    const w = px(slot.w), h = slot.h ? py(slot.h) : w * (img.height / img.width);
    ctx.drawImage(img, px(slot.x), py(slot.y), w, h);
  }

  /* ---- symbols (type / energy / set) */
  for (const slot of frame.symbolSlots || []) {
    const key = values[`symbol:${slot.id}`] || slot.symbol;
    const img = images[slot.image || (pack.symbols || {})[key]];
    if (!img) continue;
    const d = px(slot.r ? slot.r * 2 : slot.w);
    ctx.drawImage(img, px(slot.x) - d / 2, py(slot.y) - d / 2, d, d);
  }

  /* ---- text zones */
  for (const t of frame.text || []) {
    const text = fillValue(t.value, values);
    if (!text.trim() && !t.keepEmpty) continue;

    const family = t.font || pack.defaultFont || 'system-ui, sans-serif';
    const size = px(t.size ?? 0.04);
    const weight = t.weight ?? 600;
    ctx.save();
    ctx.fillStyle = t.color || '#111111';
    if (t.shadow) {
      ctx.shadowColor = t.shadow.color || 'rgba(0,0,0,.5)';
      ctx.shadowBlur = px(t.shadow.blur ?? 0.01);
      ctx.shadowOffsetY = px(t.shadow.dy ?? 0);
    }
    if (t.wrap) {
      paragraph(ctx, text, px(t.x), py(t.y), px(t.w ?? 0.8), size,
        px(t.lineHeight ?? (t.size ?? 0.04) * 1.28), weight, family, t.maxLines ?? 4);
    } else {
      fitText(ctx, text, px(t.x), py(t.y), px(t.w ?? 0.9), size, weight, family, t.align || 'left');
    }
    ctx.restore();
  }

  /* ---- attribution: most licences require it printed, not just filed */
  const line = frame.attribution || pack.attribution;
  if (line && pack.attributionPosition !== 'none') {
    const pos = pack.attributionPosition || { x: 0.5, y: 0.973, size: 0.016, align: 'center', color: '#333' };
    ctx.save();
    ctx.globalAlpha = pos.opacity ?? 0.8;
    ctx.fillStyle = pos.color || '#333333';
    fitText(ctx, fillValue(line, values), px(pos.x), py(pos.y), px(pos.w ?? 0.9),
      px(pos.size ?? 0.016), 500, pack.defaultFont || 'system-ui, sans-serif', pos.align || 'center');
    ctx.restore();
  }

  ctx.restore();

  if (approval) approvalStamp(ctx, W, H, pack);
  return { photoWindow: pw };
}

/**
 * Licensors approve artwork before it ships. Anything produced in approval mode
 * is stamped, so a review print can never be mistaken for a sale print.
 */
export function approvalStamp(ctx, W, H, pack) {
  ctx.save();
  clipped(ctx, c => roundRect(c, 0, 0, W, H, W * 0.048), c => {
    c.globalAlpha = 0.20;
    c.fillStyle = '#d21f3c';
    c.font = font(900, W * 0.062, 'system-ui, sans-serif');
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.translate(W / 2, H / 2);
    c.rotate(-0.6);
    for (let i = -3; i <= 3; i++) c.fillText('SAMPLE — FOR APPROVAL', 0, i * W * 0.20);
  });
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = 'rgba(210,31,60,.92)';
  ctx.fillRect(0, H * 0.945, W, H * 0.03);
  ctx.fillStyle = '#fff';
  ctx.font = font(800, W * 0.019, 'system-ui, sans-serif');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    `NOT FOR SALE · ${pack?.licensor?.name || 'licensor'} approval copy · ${new Date().toISOString().slice(0, 10)}`,
    W / 2, H * 0.96);
  ctx.restore();
}

/* ============================================================== loading */

/**
 * Load a pack. IO is injected so the same function works in the browser
 * (fetch + Image) and in node (readFile + node-canvas loadImage).
 */
export async function loadPack(baseUrl, { readJson, readImage, exists }) {
  const manifest = await readJson(`${baseUrl}/pack.json`);
  const hasAsset = exists ? p => exists(`${baseUrl}/${p}`) : () => true;
  const { errors, warnings } = validateManifest(manifest, { assetExists: hasAsset });
  if (errors.length) {
    throw new Error(`Asset pack "${baseUrl}" is not valid:\n  - ${errors.join('\n  - ')}`);
  }
  for (const w of warnings) console.warn(`[pack:${manifest.id}] ${w}`);

  const images = {};
  await Promise.all(packAssets(manifest)
    .filter(p => /\.(png|jpe?g|webp|gif)$/i.test(p))
    .map(async p => {
      try { images[p] = await readImage(`${baseUrl}/${p}`); }
      catch (e) { console.warn(`[pack:${manifest.id}] could not load ${p}: ${e.message}`); }
    }));

  return { manifest, images, baseUrl, warnings };
}

/** Turn pack frames into entries the picker can list alongside drawn frames. */
export function packFrames(loaded) {
  const m = loaded.manifest;
  return m.frames.map((f, i) => ({
    id: `pack:${m.id}:${f.id}`,
    name: f.name,
    baseName: f.name,
    packId: `assetpack:${m.id}`,
    packName: m.name,
    template: 'assetPack',
    assetPack: loaded,
    assetFrame: f,
    energyType: f.energyType || 'plain',
    hp: f.hp ?? 100,
    stage: f.stage || 'Licensed',
    variant: 'assetpack',
    licensed: true,
    collectorNumber: f.collectorNumber || `${m.id.toUpperCase()} ${String(i + 1).padStart(2, '0')}`,
    content: { attacks: f.attacks || [], footer: {}, ability: null },
    theme: { fontDisplay: m.defaultFont || 'system-ui, sans-serif', fontBody: m.defaultFont || 'system-ui, sans-serif' },
  }));
}
