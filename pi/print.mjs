/**
 * print.mjs — native-size printing through CUPS (Linux / Raspberry Pi, and
 * macOS), shared by electron/main.js and pi/kiosk-server.mjs.
 *
 * The page arrives already portrait, 1240 x 1844 px (the kiosk turns
 * landscape pages: printer.rotation). It's wrapped in a one-page PDF whose
 * MediaBox is exactly those pixels at 300 dpi (297.6 x 442.56 pt), and sent
 * with orientation-requested=3 (portrait) and no scaling, so CUPS neither
 * fits nor rotates it.
 *
 * Option names come from the printer itself (`lpoptions -p <printer> -l`),
 * never hardcoded. Gutenprint's DS40 driver reports (checked against
 * gutenprint.5.3://dnp-ds40):
 *   PageSize        w288h432 (4x6)   w288h432-div2 (2x6*2: 4x6 cut in two)
 *   StpLaminate     Glossy | Matte
 *   StpiShrinkOutput  Shrink | Crop | Expand   (Crop = never shrink)
 *   and its 4x6 printable area is 297.6 x 442.56 pt = 1240 x 1844 px.
 * DNP's own macOS driver names things differently (e.g. PageSize dnp6x4 and
 * a separate Cutter=2Inch); the same matching finds those too.
 */

import { execFile } from 'node:child_process';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);
const PT_PER_IN = 72;

/* ------------------------------------------------------------------ pdf */

/** Minimal JPEG dimension reader. */
export function jpegSize(buf) {
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

/**
 * One-page PDF, exactly the image's pixels at dpi. Portrait only: the kiosk
 * turns a landscape page before it gets here (printer.rotation), so a
 * landscape image is refused rather than turned a second time.
 */
export function jpegToPdf(jpeg, { dpi = 300 } = {}) {
  const { width: pw, height: ph } = jpegSize(jpeg);
  if (pw > ph) throw new Error(`Only portrait pages are printed (got ${pw}x${ph}); turn it first (printer.rotation)`);
  const W = +(pw / dpi * PT_PER_IN).toFixed(3);
  const H = +(ph / dpi * PT_PER_IN).toFixed(3);
  const cm = `${W} 0 0 ${H} 0 0`;

  const content = Buffer.from(`q\n${cm} cm\n/Im0 Do\nQ\n`, 'latin1');
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
  return { pdf: Buffer.concat(parts), pageWpt: W, pageHpt: H, pixels: { width: pw, height: ph } };
}

/* -------------------------------------------------------------- options */

/**
 * `lpoptions -p NAME -l` → { PageSize: { label, choices, default }, ... }.
 * Lines look like: "PageSize/Media Size: *B7 w288h432 w288h432-div2".
 */
export function parseLpoptions(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const m = line.match(/^([^/:\s]+)(?:\/([^:]*))?:\s*(.*)$/);
    if (!m) continue;
    const choices = m[3].trim().split(/\s+/).filter(Boolean);
    const def = choices.find(c => c.startsWith('*'));
    out[m[1]] = { label: m[2] || m[1], choices: choices.map(c => c.replace(/^\*/, '')), default: def ? def.slice(1) : null };
  }
  return out;
}

export async function readPrinterOptions(printerName) {
  const args = printerName ? ['-p', printerName, '-l'] : ['-l'];
  const { stdout } = await run('lpoptions', args);
  return parseLpoptions(stdout);
}

const FOUR_BY_SIX = /(^|[^\d.])(4x6|6x4)([^\d]|$)|^w288h432$/i;
const DIVIDED = /div2|2x6|x2\b|\*2|cut|split|_2$/i;

/**
 * Picks this printer's own option values for one print. kind '4x6' or 'strip'.
 * Returns the -o values to pass and a human-readable note per choice, or
 * problems when something the job needs isn't offered.
 */
export function chooseOptions(options, { kind = '4x6', finish = 'glossy' } = {}) {
  const set = [], notes = [], problems = [];
  const pageKey = ['PageSize', 'media', 'PageRegion'].find(k => options[k]);
  const sizes = pageKey ? options[pageKey].choices : [];
  const plain = sizes.find(c => c === 'w288h432') || sizes.find(c => FOUR_BY_SIX.test(c) && !DIVIDED.test(c));
  const divided = sizes.find(c => c === 'w288h432-div2') || sizes.find(c => FOUR_BY_SIX.test(c) && DIVIDED.test(c) && !/div4|div3/i.test(c));
  let cutKey = null;

  if (kind === 'strip') {
    if (divided) { set.push(`${pageKey}=${divided}`); notes.push(`${pageKey}=${divided} (4x6 cut into two 2x6)`); }
    else {
      // DNP's macOS driver: plain 6x4 paper plus its own cutter option.
      cutKey = Object.keys(options).find(k => /cut/i.test(k) && !/waste/i.test(k) && options[k].choices.some(c => /2\s*_?inch|2in/i.test(c)));
      if (plain) set.push(`${pageKey}=${plain}`);
      if (cutKey) {
        const v = options[cutKey].choices.find(c => /2\s*_?inch|2in/i.test(c));
        set.push(`${cutKey}=${v}`); notes.push(`${pageKey}=${plain}, ${cutKey}=${v}`);
      } else problems.push(`this printer offers no 2-inch cut (PageSize choices: ${sizes.join(' ') || 'none'}) — strips will come out uncut`);
    }
  } else if (plain) { set.push(`${pageKey}=${plain}`); notes.push(`${pageKey}=${plain}`); }
  if (!plain && !(kind === 'strip' && divided)) problems.push(`no 4x6 paper size in ${pageKey || 'PageSize'} (${sizes.join(' ') || 'none'})`);

  // Glossy / matte overcoat (Gutenprint: StpLaminate; other drivers: Finish, Overcoat, Surface...).
  const finKey = Object.keys(options).find(k => /laminat|overcoat|finish|surface|coat/i.test(k + options[k].label));
  if (finKey && finish) {
    const want = /^m/i.test(finish) ? /matte?/i : /gloss/i;
    const v = options[finKey].choices.find(c => want.test(c));
    if (v) { set.push(`${finKey}=${v}`); notes.push(`${finKey}=${v}`); }
    else problems.push(`${finKey} has no "${finish}" (${options[finKey].choices.join(' ')})`);
  }

  // Never shrink the page to fit: it's already exactly the printable area.
  if (options.StpiShrinkOutput?.choices.includes('Crop')) { set.push('StpiShrinkOutput=Crop'); notes.push('StpiShrinkOutput=Crop'); }

  return { set, notes, problems, cutKey };
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
 * @param {Buffer} o.jpeg        the page as a JPEG at native size, portrait (1240x1844)
 * @param {'4x6'|'strip'} o.kind
 * @param {string} [o.printerName]
 * @param {number} [o.copies]
 * @param {string} [o.finish]    'glossy' | 'matte'
 * @param {string[]} [o.lpOptions]  extra -o values from the config (win over detected ones)
 */
export async function printImage(o) {
  const { jpeg, kind = '4x6', printerName, copies = 1, finish = 'glossy', lpOptions = [], dryRun = false, options = null } = o;
  if (!Buffer.isBuffer(jpeg)) throw new Error('printImage: jpeg Buffer required');

  let made;
  try { made = jpegToPdf(jpeg); } catch (e) { return { ok: false, reason: e.message }; }
  const { pdf, pageWpt, pageHpt, pixels } = made;
  let detected;
  try {
    detected = chooseOptions(options || await readPrinterOptions(printerName), { kind, finish });
  } catch (e) {
    detected = { set: [], notes: [], problems: [`couldn't read the printer's options (lpoptions -p ${printerName || '(default)'} -l): ${(e.stderr || e.message || '').trim()}`] };
  }
  const dir = await mkdtemp(join(tmpdir(), 'holobooth-'));
  const file = join(dir, `${kind}-${Date.now()}.pdf`);
  await writeFile(file, pdf);

  const args = [];
  if (printerName) args.push('-d', printerName);
  args.push('-n', String(Math.max(1, copies)));
  // Already portrait and exactly the printable area at 300 dpi: tell CUPS
  // it's portrait (3) so it doesn't rotate it, and don't scale it. No
  // fit-to-page or auto-rotate options.
  for (const opt of ['orientation-requested=3', 'print-scaling=none', ...detected.set, ...(lpOptions || [])]) args.push('-o', opt);
  args.push(file);

  const info = {
    command: `lp ${args.join(' ')}`,
    pixels: `${pixels.width}x${pixels.height}`,
    pdfPage: `${pageWpt}x${pageHpt}pt`,
    options: detected.notes,
    problems: detected.problems,
  };
  if (dryRun) return { ok: true, dryRun: true, ...info, bytes: pdf.length, file };

  try {
    const { stdout } = await run('lp', args);
    return { ok: true, jobId: (stdout.match(/request id is (\S+)/) || [])[1] || null, ...info };
  } catch (e) {
    return { ok: false, reason: (e.stderr || e.message || '').trim() || 'lp failed', ...info };
  } finally {
    setTimeout(() => unlink(file).catch(() => {}), 60000).unref?.();
  }
}
