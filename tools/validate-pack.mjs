/**
 * Check an asset pack before it prints anything.
 *
 *   node tools/validate-pack.mjs packs/example-studio
 *
 * Beyond the manifest schema, this inspects the actual pixels — the checks that
 * catch the mistakes that only show up on paper:
 *
 *   * is the photo window actually transparent in the frame art?
 *     (a frame exported without alpha prints an opaque rectangle over the photo)
 *   * is the art big enough for a 300dpi card?
 *     (upscaled art looks fine on the touchscreen and soft in the hand)
 *   * do text zones sit inside the card, and is any of them over the photo?
 *   * is the licence paperwork actually in the folder?
 */
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, packAssets } from '../src/js/frames/assetpack.mjs';
import { printSize } from '../src/js/frames/render.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packDir = resolve(root, process.argv[2] || 'packs/example-studio');

let errors = 0, warnings = 0;
const err = m => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); errors++; };
const warn = m => { console.log(`  \x1b[33m!\x1b[0m ${m}`); warnings++; };
const ok = m => console.log(`  \x1b[32m✓\x1b[0m ${m}`);

console.log(`\nvalidating ${packDir}\n`);

if (!existsSync(join(packDir, 'pack.json'))) {
  console.log('  \x1b[31m✗\x1b[0m no pack.json — is this a pack folder?\n');
  process.exit(1);
}

const manifest = JSON.parse(await readFile(join(packDir, 'pack.json'), 'utf8'));
const res = validateManifest(manifest, { assetExists: p => existsSync(join(packDir, p)) });
res.errors.forEach(err);
res.warnings.forEach(warn);
if (!res.errors.length) ok(`manifest: ${manifest.name} (${manifest.frames.length} frames)`);

/* ---- licensing paperwork */
if (existsSync(join(packDir, 'LICENSE.txt'))) {
  const txt = await readFile(join(packDir, 'LICENSE.txt'), 'utf8');
  if (txt.trim().length < 120) warn('LICENSE.txt looks like a stub — put the real grant here');
  else ok('LICENSE.txt present');
}
if (manifest.licensor?.name && manifest.attribution) ok(`attribution: "${manifest.attribution}"`);

/* ---- pixels */
const { W: printW, H: printH } = printSize('card', 300);

for (const f of manifest.frames) {
  const label = `frame "${f.id}"`;
  const artPath = join(packDir, f.art);
  if (!existsSync(artPath)) { err(`${label}: missing art ${f.art}`); continue; }

  let img;
  try { img = await loadImage(await readFile(artPath)); }
  catch (e) { err(`${label}: art will not decode (${e.message})`); continue; }

  // resolution vs the print master
  if (img.width < printW || img.height < printH) {
    warn(`${label}: art is ${img.width}x${img.height}, smaller than the ${printW}x${printH} print master — it will be upscaled`);
  } else {
    ok(`${label}: art ${img.width}x${img.height} (>= ${printW}x${printH})`);
  }

  // aspect
  const want = (f.aspect?.[0] ?? 2.5) / (f.aspect?.[1] ?? 3.5);
  const got = img.width / img.height;
  if (Math.abs(want - got) > 0.02) {
    warn(`${label}: art aspect ${got.toFixed(3)} does not match the card's ${want.toFixed(3)} — it will be stretched`);
  }

  // the important one: is the photo window transparent?
  const c = createCanvas(img.width, img.height);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const pw = f.photoWindow;
  const wx = Math.round(pw.x * img.width), wy = Math.round(pw.y * img.height);
  const ww = Math.round(pw.w * img.width), wh = Math.round(pw.h * img.height);

  let opaque = 0, sampled = 0;
  const step = Math.max(1, Math.floor(Math.min(ww, wh) / 40));
  for (let sy = wy + step; sy < wy + wh - step; sy += step) {
    for (let sx = wx + step; sx < wx + ww - step; sx += step) {
      const a = x.getImageData(sx, sy, 1, 1).data[3];
      sampled++;
      if (a > 24) opaque++;
    }
  }
  const pct = sampled ? (opaque / sampled) * 100 : 100;
  if (pct > 8) {
    err(`${label}: photo window is ${pct.toFixed(0)}% opaque — the frame art will cover the photo. ` +
        `Export the art with the window knocked out, or move photoWindow.`);
  } else {
    ok(`${label}: photo window is transparent (${pct.toFixed(1)}% opaque)`);
  }

  // text zones inside the card, and not floating over the photo
  for (const t of f.text || []) {
    if (t.x < 0 || t.x > 1 || t.y < 0 || t.y > 1) err(`${label}: text "${t.id}" sits outside the card`);
    const overPhoto = t.x > pw.x && t.x < pw.x + pw.w && t.y > pw.y && t.y < pw.y + pw.h;
    if (overPhoto && !t.overPhoto) {
      warn(`${label}: text "${t.id}" sits over the photo window — set "overPhoto": true if that is deliberate`);
    }
  }
}

/* ---- unreferenced files, a common sign of a half-finished swap */
const referenced = new Set(packAssets(manifest));
for (const dir of ['frames', 'symbols', 'characters']) {
  if (!existsSync(join(packDir, dir))) continue;
  for (const file of await readdir(join(packDir, dir))) {
    const rel = `${dir}/${file}`;
    if (!referenced.has(rel) && /\.(png|jpe?g|webp)$/i.test(file)) {
      warn(`${rel} is in the pack but not referenced by pack.json`);
    }
  }
}

console.log(`\n${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}\n`);
process.exit(errors ? 1 : 0);
