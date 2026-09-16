/**
 * print.mjs — exact-size printing on Linux through CUPS.
 *
 * The problem this solves: dye-sub printers are unforgiving about geometry. If
 * the page you hand CUPS isn't exactly the media size, the driver scales it,
 * and a 2.5x3.5" card comes out at 2.42x3.39" — close enough to look fine and
 * wrong enough that it won't sit in a card sleeve.
 *
 * A PNG carries no physical size, so `lp` has to guess. A PDF carries a
 * MediaBox in points, which is unambiguous. So: take the browser's JPEG,
 * wrap it in a one-page PDF whose MediaBox is exactly the card, and print that
 * with scaling switched off. No ImageMagick, no Ghostscript, no dependencies —
 * PDF can carry a JPEG bitstream verbatim via /DCTDecode.
 */

import { execFile } from 'node:child_process';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);
const PT_PER_IN = 72;

/* ------------------------------------------------------------------ pdf */

/** Minimal JPEG dimension reader — we need the pixel size for the transform. */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    // SOF0..SOF15, excluding DHT(c4), JPG(c8) and DAC(cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('Not a JPEG, or no SOF marker found');
}

/** Wrap a JPEG in a one-page PDF sized exactly widthIn x heightIn. */
export function jpegToPdf(jpeg, widthIn, heightIn) {
  const { width: pw, height: ph } = jpegSize(jpeg);
  const W = +(widthIn * PT_PER_IN).toFixed(3);
  const H = +(heightIn * PT_PER_IN).toFixed(3);

  const content = Buffer.from(`q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`, 'latin1');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    { dict: `<< /Type /XObject /Subtype /Image /Width ${pw} /Height ${ph} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
      stream: jpeg },
    { dict: `<< /Length ${content.length} >>`, stream: content },
  ];

  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [];
  let pos = parts[0].length;

  objs.forEach((o, i) => {
    const n = i + 1;
    offsets.push(pos);
    const head = typeof o === 'string'
      ? Buffer.from(`${n} 0 obj\n${o}\nendobj\n`, 'latin1')
      : Buffer.from(`${n} 0 obj\n${o.dict}\nstream\n`, 'latin1');
    parts.push(head); pos += head.length;
    if (typeof o !== 'string') {
      parts.push(o.stream); pos += o.stream.length;
      const tail = Buffer.from('\nendstream\nendobj\n', 'latin1');
      parts.push(tail); pos += tail.length;
    }
  });

  const xrefPos = pos;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));

  return Buffer.concat(parts);
}

/* ------------------------------------------------------------------ lp */

export async function listPrinters() {
  try {
    const { stdout } = await run('lpstat', ['-e']);
    const names = stdout.split('\n').map(s => s.trim()).filter(Boolean);
    let def = null;
    try {
      const d = await run('lpstat', ['-d']);
      def = (d.stdout.match(/:\s*(\S+)/) || [])[1] || null;
    } catch {}
    return names.map(name => ({ name, displayName: name, isDefault: name === def }));
  } catch (e) {
    return [];
  }
}

/**
 * @param {object} o
 * @param {string} o.dataUrl   image/jpeg or image/png data URL from the kiosk
 * @param {number} o.widthIn   @param {number} o.heightIn
 * @param {string} [o.printerName]
 * @param {number} [o.copies]
 * @param {string[]} [o.lpOptions]  extra `-o` values from booth.config.json
 */
export async function printImage(o) {
  const { dataUrl, widthIn, heightIn, printerName, copies = 1, lpOptions = [], dryRun = false } = o;

  const [meta, b64] = String(dataUrl).split(',');
  if (!b64) throw new Error('printImage: dataUrl has no payload');
  if (!/jpeg|jpg/i.test(meta)) {
    // The kiosk should send JPEG — PDF can embed it verbatim. PNG would need
    // re-encoding, which means a dependency we don't want on a Pi.
    throw new Error('printImage expects an image/jpeg data URL (see canvas.toDataURL("image/jpeg", .95))');
  }

  const pdf = jpegToPdf(Buffer.from(b64, 'base64'), widthIn, heightIn);
  const dir = await mkdtemp(join(tmpdir(), 'holobooth-'));
  const file = join(dir, `card-${Date.now()}.pdf`);
  await writeFile(file, pdf);

  const args = [];
  if (printerName) args.push('-d', printerName);
  args.push('-n', String(Math.max(1, copies)));
  // Exact geometry: matching media, no scaling, no margins the driver invents.
  args.push('-o', `media=Custom.${widthIn}x${heightIn}in`);
  args.push('-o', 'print-scaling=none');
  args.push('-o', 'fit-to-page=false');
  for (const opt of lpOptions) args.push('-o', opt);
  args.push(file);

  if (dryRun) return { ok: true, dryRun: true, command: `lp ${args.join(' ')}`, bytes: pdf.length, file };

  try {
    const { stdout } = await run('lp', args);
    return { ok: true, jobId: (stdout.match(/request id is (\S+)/) || [])[1] || null, command: `lp ${args.join(' ')}` };
  } catch (e) {
    return { ok: false, reason: (e.stderr || e.message || '').trim() || 'lp failed' };
  } finally {
    setTimeout(() => unlink(file).catch(() => {}), 60000).unref?.();
  }
}
