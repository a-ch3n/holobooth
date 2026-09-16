/**
 * gif.js — animated GIF encoding in the renderer, no worker, no library.
 *
 * A photobooth GIF is a small, forgiving problem: ~12 frames, 480px wide, and
 * the frames share a scene so one palette built from the middle frame quantises
 * all of them well. That lets us do median-cut once instead of per frame, which
 * is what keeps this under ~400ms on booth-grade hardware.
 */

export async function encodeGif(canvases, { width = 480, fps = 12, boomerang = true, loop = 0 } = {}) {
  if (!canvases.length) throw new Error('No frames to encode');

  const src = boomerang ? [...canvases, ...canvases.slice(1, -1).reverse()] : canvases;
  const aspect = canvases[0].height / canvases[0].width;
  const w = width, h = Math.round(width * aspect);

  const frames = src.map(c => {
    const t = document.createElement('canvas');
    t.width = w; t.height = h;
    t.getContext('2d').drawImage(c, 0, 0, w, h);
    return t.getContext('2d').getImageData(0, 0, w, h).data;
  });

  const palette = medianCut(frames[Math.floor(frames.length / 2)], 255);
  const delay = Math.max(2, Math.round(100 / fps)); // GIF delay is in 1/100s

  const buf = new ByteWriter();
  writeHeader(buf, w, h, palette);
  writeNetscape(buf, loop);
  for (const f of frames) {
    const indexed = quantize(f, palette, w, h);
    writeGraphicControl(buf, delay);
    writeImage(buf, w, h, indexed);
  }
  buf.byte(0x3b); // trailer
  return new Blob([buf.bytes()], { type: 'image/gif' });
}

/* ------------------------------------------------------------- palette */

function medianCut(data, maxColors) {
  const pixels = [];
  for (let i = 0; i < data.length; i += 4 * 7) pixels.push([data[i], data[i + 1], data[i + 2]]);
  let boxes = [pixels];
  while (boxes.length < maxColors) {
    boxes.sort((a, b) => range(b) - range(a));
    const box = boxes.shift();
    if (!box || box.length < 2 || range(box) === 0) { if (box) boxes.push(box); break; }
    const ch = widestChannel(box);
    box.sort((p, q) => p[ch] - q[ch]);
    const mid = box.length >> 1;
    boxes.push(box.slice(0, mid), box.slice(mid));
  }
  const pal = boxes.map(b => {
    const n = b.length || 1;
    const s = b.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    return [Math.round(s[0] / n), Math.round(s[1] / n), Math.round(s[2] / n)];
  });
  while (pal.length < 256) pal.push([0, 0, 0]);
  return pal.slice(0, 256);
}

function widestChannel(box) {
  let best = 0, bestSpan = -1;
  for (let ch = 0; ch < 3; ch++) {
    let lo = 255, hi = 0;
    for (const p of box) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
    if (hi - lo > bestSpan) { bestSpan = hi - lo; best = ch; }
  }
  return best;
}
function range(box) {
  let span = 0;
  for (let ch = 0; ch < 3; ch++) {
    let lo = 255, hi = 0;
    for (const p of box) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
    span = Math.max(span, hi - lo);
  }
  return span;
}

function quantize(data, palette, w, h) {
  const out = new Uint8Array(w * h);
  const cache = new Map();
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const key = (data[i] >> 3 << 10) | (data[i + 1] >> 3 << 5) | (data[i + 2] >> 3);
    let idx = cache.get(key);
    if (idx === undefined) {
      let best = 0, bestD = Infinity;
      for (let k = 0; k < palette.length; k++) {
        const dr = data[i] - palette[k][0], dg = data[i + 1] - palette[k][1], db = data[i + 2] - palette[k][2];
        const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (d < bestD) { bestD = d; best = k; }
      }
      idx = best;
      cache.set(key, idx);
    }
    out[p] = idx;
  }
  return out;
}

/* -------------------------------------------------------------- writer */

class ByteWriter {
  constructor() { this.a = []; }
  byte(b) { this.a.push(b & 255); }
  short(v) { this.byte(v); this.byte(v >> 8); }
  str(s) { for (const c of s) this.byte(c.charCodeAt(0)); }
  bytes() { return new Uint8Array(this.a); }
}

function writeHeader(b, w, h, palette) {
  b.str('GIF89a');
  b.short(w); b.short(h);
  b.byte(0xf7);           // global colour table, 256 entries, 8 bits/pixel
  b.byte(0); b.byte(0);
  for (const c of palette) { b.byte(c[0]); b.byte(c[1]); b.byte(c[2]); }
}

function writeNetscape(b, loop) {
  b.byte(0x21); b.byte(0xff); b.byte(11);
  b.str('NETSCAPE2.0');
  b.byte(3); b.byte(1); b.short(loop); b.byte(0);
}

function writeGraphicControl(b, delay) {
  b.byte(0x21); b.byte(0xf9); b.byte(4);
  b.byte(0);            // no transparency, no disposal
  b.short(delay);
  b.byte(0); b.byte(0);
}

function writeImage(b, w, h, indexed) {
  b.byte(0x2c);
  b.short(0); b.short(0); b.short(w); b.short(h);
  b.byte(0);
  const minCode = 8;
  b.byte(minCode);
  const lzw = lzwEncode(indexed, minCode);
  for (let i = 0; i < lzw.length; i += 255) {
    const chunk = lzw.subarray(i, i + 255);
    b.byte(chunk.length);
    for (const v of chunk) b.byte(v);
  }
  b.byte(0);
}

function lzwEncode(pixels, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  let dict = new Map(), next = eoi + 1, codeSize = minCode + 1;
  const out = [];
  let cur = 0, bits = 0;
  const emit = code => {
    cur |= code << bits; bits += codeSize;
    while (bits >= 8) { out.push(cur & 255); cur >>= 8; bits -= 8; }
  };
  const reset = () => { dict = new Map(); next = eoi + 1; codeSize = minCode + 1; };

  emit(clear);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const key = prefix * 4096 + k;
    if (dict.has(key)) { prefix = dict.get(key); continue; }
    emit(prefix);
    dict.set(key, next++);
    if (next > (1 << codeSize)) {
      if (codeSize < 12) codeSize++;
      else { emit(clear); reset(); }
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return new Uint8Array(out);
}
