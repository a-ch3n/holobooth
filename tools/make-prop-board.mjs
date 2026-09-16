/**
 * Export an oversized photo-prop board as a print-ready PDF.
 *
 *   node tools/make-prop-board.mjs --frame party-bubblegum --name Audrey --age 6 --buddy twinkle
 *
 * Send the PDF to a print shop mounted on 5mm foam board, cut the window, and
 * you have the prop from the party — matching the cards the booth prints.
 */
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setCanvasFactory } from '../src/js/frames/draw.mjs';
import { renderPropBoard, mintCard, printSize } from '../src/js/frames/render.mjs';
import { companionCanvas, companionById, COMPANIONS } from '../src/js/frames/companions.mjs';
import { jpegToPdf } from '../pi/print.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
setCanvasFactory((w, h) => createCanvas(w, h));
for (const [alias, path] of Object.entries({
  'Nunito': '/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf',
  'Baloo 2': '/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf',
})) { try { GlobalFonts.registerFromPath(path, alias); } catch {} }

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};

const frameId = arg('frame', 'party-bubblegum');
const name = arg('name', 'Audrey');
const age = Number(arg('age', 6));
const buddyId = arg('buddy', COMPANIONS[0].id);
const out = join(root, 'out', 'boards');
mkdirSync(out, { recursive: true });

const { W, H, widthIn, heightIn, dpi } = printSize('board');
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, W, H);

const buddy = companionById(buddyId);
const companionImg = companionCanvas(buddy, 1024, createCanvas);

renderPropBoard(ctx, {
  frameId, W, H,
  companion: companionImg,
  card: mintCard({ frameId, mint: 1, forcedRarity: 'rare' }),
  personalization: { name, age, companionId: buddyId },
});

const slug = `${name.toLowerCase().replace(/\W+/g, '-')}-${frameId}`;
const jpeg = canvas.toBuffer('image/jpeg', 92);
writeFileSync(join(out, `${slug}.jpg`), jpeg);
writeFileSync(join(out, `${slug}.pdf`), jpegToPdf(jpeg, widthIn, heightIn));

console.log(`prop board: ${widthIn}x${heightIn}in @ ${dpi}dpi  (${W}x${H}px)`);
console.log(`  ${join(out, slug)}.pdf`);
console.log(`  ${join(out, slug)}.jpg`);
