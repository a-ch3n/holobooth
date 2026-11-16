/**
 * fonts.mjs — the typefaces the strip collection uses, bundled in src/fonts
 * (all SIL Open Font License, see src/fonts/OFL-*.txt) so prints look the
 * same on any booth PC, offline.
 *
 * The kiosk loads them with loadFonts() (FontFace API) before rendering;
 * node tools register the same files with @napi-rs/canvas (tools/strip-collection.mjs).
 */
export const FONT_FILES = [
  ['Playfair Display', 400, 'normal', 'playfair-display-400-normal.woff2'],
  ['Playfair Display', 400, 'italic', 'playfair-display-400-italic.woff2'],
  ['Playfair Display', 700, 'normal', 'playfair-display-700-normal.woff2'],
  ['Playfair Display', 900, 'normal', 'playfair-display-900-normal.woff2'],
  ['Cormorant Garamond', 300, 'normal', 'cormorant-garamond-300-normal.woff2'],
  ['Cormorant Garamond', 400, 'italic', 'cormorant-garamond-400-italic.woff2'],
  ['Cormorant Garamond', 500, 'normal', 'cormorant-garamond-500-normal.woff2'],
  ['Cormorant Garamond', 600, 'normal', 'cormorant-garamond-600-normal.woff2'],
  ['Caveat', 500, 'normal', 'caveat-500-normal.woff2'],
  ['Caveat', 700, 'normal', 'caveat-700-normal.woff2'],
  ['Great Vibes', 400, 'normal', 'great-vibes-400-normal.woff2'],
  ['Orbitron', 500, 'normal', 'orbitron-500-normal.woff2'],
  ['Orbitron', 800, 'normal', 'orbitron-800-normal.woff2'],
  ['Anton', 400, 'normal', 'anton-400-normal.woff2'],
  ['Permanent Marker', 400, 'normal', 'permanent-marker-400-normal.woff2'],
  ['Courier Prime', 400, 'normal', 'courier-prime-400-normal.woff2'],
  ['Courier Prime', 700, 'normal', 'courier-prime-700-normal.woff2'],
  ['Quicksand', 500, 'normal', 'quicksand-500-normal.woff2'],
  ['Quicksand', 700, 'normal', 'quicksand-700-normal.woff2'],
  ['Fredoka', 500, 'normal', 'fredoka-500-normal.woff2'],
  ['Fredoka', 700, 'normal', 'fredoka-700-normal.woff2'],
  ['Inter', 300, 'normal', 'inter-300-normal.woff2'],
  ['Inter', 500, 'normal', 'inter-500-normal.woff2'],
  ['Inter', 700, 'normal', 'inter-700-normal.woff2'],
  ['Inter', 800, 'normal', 'inter-800-normal.woff2'],
  // Hangul for the Korean designs: a renamed subset of NanumSquareRound Bold (OFL-holobooth-hangul.txt).
  ['HoloBooth Hangul', 700, 'normal', 'holobooth-hangul-700.woff2'],
].map(([family, weight, style, file]) => ({ family, weight, style, file }));

/** Browser: load every font before the first render. baseUrl is where src/fonts is, relative to the page. */
export async function loadFonts(baseUrl = 'fonts/') {
  if (typeof FontFace === 'undefined' || !globalThis.document?.fonts) return 0;
  const faces = FONT_FILES.map(f => new FontFace(f.family, `url(${baseUrl}${f.file})`, { weight: String(f.weight), style: f.style }));
  const loaded = await Promise.allSettled(faces.map(face => face.load()));
  let n = 0;
  loaded.forEach(r => { if (r.status === 'fulfilled') { document.fonts.add(r.value); n++; } });
  return n;
}
