/**
 * Which Windows printer a job goes to. With no printer named in the config,
 * the photo printer is found by name rather than trusting the Windows
 * default, which on most PCs is "Microsoft Print to PDF" or similar. A print
 * silently sent there never comes out of the dye-sub.
 */
const PHOTO_PRINTER = /\bDS-?40\b|\bDS-?RX1|\bDS-?620|\bDS-?820|\bQW-?410|\bDNP\b|Citizen|\bCY-?02|\bCX-?02|SELPHY|Mitsubishi|\bCP-?(D|K|M|W)\d|HiTi|Kodak 6\d{3}|Sinfonia|Shinko|CHC-S/i;
const VIRTUAL = /PDF|XPS|OneNote|Fax|Send To|Snagit|Document Writer/i;

// Windows PRINTER_STATUS_OFFLINE (0x80) / NOT_AVAILABLE (0x1000).
const offline = p => typeof p.status === 'number' && (p.status & (0x80 | 0x1000)) !== 0;

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
  // Windows often has the same printer twice ("DS40" and "DS40 (Copy 1)")
  // after a reinstall or a different USB port; prefer one that isn't
  // offline, then the Windows default among them.
  const photos = printers.filter(p => PHOTO_PRINTER.test(p.name) || PHOTO_PRINTER.test(p.displayName || ''));
  const photo = photos.find(p => !offline(p) && p.isDefault) || photos.find(p => !offline(p)) || photos[0];
  if (photo) return { name: photo.name, why: photos.length > 1 ? `photo printer found by name (one of ${photos.length})` : 'photo printer found by name' };
  const def = printers.find(p => p.isDefault);
  if (def && !VIRTUAL.test(def.name)) return { name: def.name, why: 'Windows default printer' };
  return {
    error: 'No photo printer is installed in Windows' +
      (def ? ` (the default is "${def.name}", which isn't a real printer)` : '') +
      '. Install the DNP DS40 driver, then check Settings → Bluetooth & devices → Printers & scanners.',
  };
}

module.exports = { choosePrinter, PHOTO_PRINTER };
