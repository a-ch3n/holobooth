/**
 * Which Windows printer a job goes to. With no printer named in the config,
 * the photo printer is found by name rather than trusting the Windows
 * default, which on most PCs is "Microsoft Print to PDF" or similar. A print
 * silently sent there never comes out of the dye-sub.
 */
const PHOTO_PRINTER = /\bDS-?40\b|\bDS-?RX1|\bDS-?620|\bDS-?820|\bQW-?410|\bDNP\b|Citizen|\bCY-?02|\bCX-?02|SELPHY|Mitsubishi|\bCP-?(D|K|M|W)\d|HiTi|Kodak 6\d{3}|Sinfonia|Shinko|CHC-S/i;
const VIRTUAL = /PDF|XPS|OneNote|Fax|Send To|Snagit|Document Writer/i;

const label = p => `${p.name}${p.displayName && p.displayName !== p.name ? ` (${p.displayName})` : ''}`;

/**
 * @param {Array<{name:string, displayName?:string, isDefault?:boolean}>} printers
 * @param {string|null} requested  printing.cardPrinterName / stripPrinterName
 * @returns {{ name: string|null, why: string } | { error: string }}
 */
function choosePrinter(printers, requested) {
  if (requested) {
    const hit = printers.find(p => p.name === requested || p.displayName === requested)
      || printers.find(p => p.name.toLowerCase().includes(requested.toLowerCase()));
    if (hit) return { name: hit.name, why: `configured (${requested})` };
    return { error: `Printer "${requested}" isn't installed in Windows. Installed: ${printers.map(label).join(', ') || 'none'}.` };
  }
  const photo = printers.find(p => PHOTO_PRINTER.test(p.name) || PHOTO_PRINTER.test(p.displayName || ''));
  if (photo) return { name: photo.name, why: 'photo printer found by name' };
  const def = printers.find(p => p.isDefault);
  if (def && !VIRTUAL.test(def.name)) return { name: def.name, why: 'Windows default printer' };
  return {
    error: 'No photo printer is installed in Windows' +
      (def ? ` (the default is "${def.name}", which isn't a real printer)` : '') +
      '. Install the DNP DS40 driver, then check Settings → Bluetooth & devices → Printers & scanners.',
  };
}

module.exports = { choosePrinter, PHOTO_PRINTER };
