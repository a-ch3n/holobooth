/**
 * catalog.mjs — the HoloBooth Strip Collection as kiosk frames.
 *
 *   Signature Strips  12 concepts (A–L) on the classic 2x6 strip
 *   Jumbo Strips      the same 12 concepts on a full 4x6 sheet, 3–5 photos
 *
 * Every style × palette becomes a frame id (`sd-<style>-<palette>` and
 * `jb-<style>-<palette>`), so every colourway is addressable by the rest of
 * the kiosk exactly like any other frame. Only each style's lead palette is
 * shown in the picker; the others appear as colour chips on the Decorate →
 * Frame tab (see frame.paletteOf).
 */

import { registerStyles, styleById, FORMATS, stripDesign } from './engine.mjs';
import * as A from './styles-a.mjs';
import * as B from './styles-b.mjs';

export const STYLE_ORDER = [
  A.luxe, A.reel, A.y2k, A.seoul, A.editorial, A.instant,
  B.chrome, B.scrapbook, B.datenight, B.birthday, B.keepsake, B.street,
];
registerStyles(Object.fromEntries(STYLE_ORDER.map(s => [s.id, s])));

/**
 * Shot counts and lead palettes. Standard strips are four frames where four
 * read well at 2x6, three where the concept needs room (instant borders,
 * editorial asymmetry, scrapbook paper). Jumbo mixes 3, 4 and 5.
 */
export const COLLECTION = {
  strip: {
    luxe: { shots: 4, palette: 'ivory' },
    reel: { shots: 4, palette: 'gold' },
    y2k: { shots: 4, palette: 'bubblegum' },
    seoul: { shots: 4, palette: 'milk' },
    editorial: { shots: 3, palette: 'press' },
    instant: { shots: 3, palette: 'kraft' },
    chrome: { shots: 4, palette: 'silver' },
    scrapbook: { shots: 3, palette: 'kraft' },
    datenight: { shots: 3, palette: 'rouge' },
    birthday: { shots: 3, palette: 'confetti' },
    keepsake: { shots: 3, palette: 'botanical' },
    street: { shots: 4, palette: 'blackout' },
  },
  jumbo: {
    luxe: { shots: 3, palette: 'noir' },
    reel: { shots: 3, palette: 'gold' },
    editorial: { shots: 5, palette: 'mono' },
    seoul: { shots: 4, palette: 'milk' },
    instant: { shots: 4, palette: 'linen' },
    y2k: { shots: 4, palette: 'cyber' },
    chrome: { shots: 4, palette: 'holo' },
    scrapbook: { shots: 4, palette: 'gingham' },
    datenight: { shots: 3, palette: 'midnight' },
    birthday: { shots: 5, palette: 'confetti' },
    keepsake: { shots: 3, palette: 'botanical' },
    street: { shots: 3, palette: 'concrete' },
  },
};

const PACK = { strip: 'signature', jumbo: 'jumbo' };
const PREFIX = { strip: 'sd', jumbo: 'jb' };

/** Fallback theme for code paths that read frame.theme (overlays, labels). */
function themeFrom(pal) {
  const ink = pal.ink || '#111';
  const bg = pal.bg ? (Array.isArray(pal.bg) ? pal.bg[0] : pal.bg) : (pal.film || pal.g?.[0] || '#ffffff');
  return {
    type: 'plain', border: bg, borderEdge: ink, borderDark: ink, accent: pal.accent || ink,
    plate: bg, plateText: ink, textbox: bg, textboxText: ink, glow: pal.accent || ink, pip: ink,
    fontDisplay: '"Avenir Next", "Segoe UI", Arial, sans-serif', fontBody: '"Avenir Next", "Segoe UI", Arial, sans-serif',
  };
}

/** Swatch colours for a palette chip: [ground, ink, accent]. */
export function paletteSwatch(pal) {
  const bg = Array.isArray(pal.bg) ? pal.bg[0] : (pal.bg || pal.film || pal.g?.[0]);
  const ink = pal.ink || pal.labelInk || '#111';
  const accent = pal.accent || pal.label || pal.a || pal.line || pal.leaf || pal.pop || pal.tint || pal.pops?.[0] || ink;
  return [bg, ink, accent];
}

/** Every Signature and Jumbo frame, palette variants included. */
export function stripDesignFrames() {
  const out = [];
  for (const format of ['strip', 'jumbo']) {
    let k = 0;
    for (const style of STYLE_ORDER) {
      const c = COLLECTION[format][style.id];
      if (!c) continue;
      k++;
      const lead = c.palette;
      const paletteIds = [lead, ...Object.keys(style.palettes).filter(p => p !== lead)];
      for (const pid of paletteIds) {
        const pal = style.palettes[pid];
        out.push({
          id: `${PREFIX[format]}-${style.id}-${pid}`,
          name: style.name,
          baseName: style.name,
          paletteName: pal.name,
          variant: 'strip',
          strip: true,
          jumbo: format === 'jumbo',
          packId: PACK[format],
          paletteOf: `${PREFIX[format]}-${style.id}`,
          paletteVariant: pid !== lead,
          energyType: 'plain',
          swatch: paletteSwatch(pal),
          stage: format === 'jumbo' ? 'Jumbo' : 'Strip',
          hp: 0,
          stock: 'none',
          template: 'stripDesign',
          aspect: [FORMATS[format].widthIn, FORMATS[format].heightIn],
          theme: themeFrom(pal),
          rarityFloor: 'common',
          designNumber: k,
          collectorNumber: `${format === 'jumbo' ? 'JUMBO' : 'SIG'} ${style.letter}`,
          design: { style: style.id, palette: pid, format, shots: c.shots },
          blurb: style.blurb,
          content: { cells: c.shots, ability: null, attacks: [], flavor: null, footer: {}, maxRule: null },
        });
      }
    }
  }
  return out;
}

export { styleById, FORMATS, stripDesign };
