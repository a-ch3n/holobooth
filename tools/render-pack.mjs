/**
 * Render sample cards from an asset pack — the check you run after your
 * licensor sends you files, before anything reaches a printer.
 *
 *   node tools/render-pack.mjs packs/example-studio [--approval]
 */
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setCanvasFactory } from '../src/js/frames/draw.mjs';
import { loadPack, packFrames } from '../src/js/frames/assetpack.mjs';
import { renderCard, mintCard, printSize } from '../src/js/frames/render.mjs';
import { drawFakePhoto } from './fixtures.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
setCanvasFactory((w, h) => createCanvas(w, h));
for (const [alias, p] of Object.entries({
  'Nunito': '/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf',
})) { try { GlobalFonts.registerFromPath(p, alias); } catch {} }

const packDir = process.argv[2] || 'packs/example-studio';
const approval = process.argv.includes('--approval');
const abs = join(root, packDir);

const loaded = await loadPack(abs, {
  readJson: async p => JSON.parse(await readFile(p, 'utf8')),
  readImage: async p => loadImage(await readFile(p)),
  exists: p => existsSync(p),
});

console.log(`\npack: ${loaded.manifest.name} (${loaded.manifest.id})`);
console.log(`  licensor:    ${loaded.manifest.licensor?.name || '— not set —'}`);
console.log(`  attribution: ${loaded.manifest.attribution || '— not set —'}`);
console.log(`  frames:      ${loaded.manifest.frames.length}`);
console.log(`  images:      ${Object.keys(loaded.images).length} loaded`);
if (loaded.warnings.length) console.log(`  warnings:    ${loaded.warnings.length}`);

const out = join(root, 'out', 'packs', loaded.manifest.id);
await mkdir(out, { recursive: true });

const { W, H } = printSize('card', 300);
const pc = createCanvas(1600, 1600);
drawFakePhoto(pc.getContext('2d'), 1600, 1600, 2);
const photo = await loadImage(pc.toBuffer('image/png'));

const frames = packFrames(loaded);
for (const f of frames) {
  const canvas = createCanvas(W, H);
  renderCard(canvas.getContext('2d'), {
    frame: f, frameId: f.id, W, H, photo,
    card: mintCard({ frame: f, frameId: f.id, mint: 12, forcedRarity: 'rare' }),
    personalization: { name: 'Audrey', age: 6 },
    approvalMode: approval,
  });
  const file = join(out, `${f.assetFrame.id}.png`);
  await writeFile(file, canvas.toBuffer('image/png'));
  console.log(`  ✓ ${f.name.padEnd(18)} ${f.collectorNumber}`);
}
console.log(`\n${frames.length} cards -> out/packs/${loaded.manifest.id}${approval ? '  (APPROVAL STAMPED)' : ''}\n`);
