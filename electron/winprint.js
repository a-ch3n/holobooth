/**
 * winprint.js — Windows printing through the printer driver's own paper
 * sizes, the same way Windows' "Print a test page" does.
 *
 * Chromium's print path sends a custom page size (e.g. 6x4in in microns).
 * DNP's driver only accepts its own named forms, so those jobs never came out,
 * while the driver's test page printed fine. This picks the driver's paper
 * size that matches the sheet (either orientation), sets landscape to suit,
 * and draws the image edge to edge with GDI+ via PowerShell. Nothing to install.
 *
 * Paper choice, among sizes matching the sheet's dimensions:
 *   paperHint set (e.g. the strip sheet's "2\s*inch|2in|x2"): prefer a name matching it
 *   no hint: prefer one WITHOUT cut/x2 in its name, so cards are never cut
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SCRIPT = String.raw`
param([string]$Printer, [string]$Image = '', [double]$W = 0, [double]$H = 0, [int]$Copies = 1, [string]$Hint = '', [switch]$List)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $Printer
if (-not $doc.PrinterSettings.IsValid) { Write-Output "ERR Printer not found: $Printer"; exit 2 }
$sizes = @($doc.PrinterSettings.PaperSizes)
if ($List) { foreach ($s in $sizes) { Write-Output ("SIZE {0}|{1}|{2}" -f $s.PaperName, $s.Width, $s.Height) }; exit 0 }
# PaperSize is in hundredths of an inch.
$ww = [int]($W * 100); $hh = [int]($H * 100)
$fit = @($sizes | Where-Object { ([math]::Abs($_.Width - $ww) -le 15 -and [math]::Abs($_.Height - $hh) -le 15) -or ([math]::Abs($_.Width - $hh) -le 15 -and [math]::Abs($_.Height - $ww) -le 15) })
if ($fit.Count -eq 0) {
  $all = ($sizes | ForEach-Object { '{0} ({1}x{2}in)' -f $_.PaperName, ($_.Width / 100), ($_.Height / 100) }) -join '; '
  Write-Output "ERR The printer has no $($W)x$($H)in paper size. It has: $all"; exit 3
}
$pick = $null
if ($Hint) { $pick = $fit | Where-Object { $_.PaperName -match $Hint } | Select-Object -First 1 }
if (-not $pick) { $pick = $fit | Where-Object { $_.PaperName -notmatch '(?i)cut|x\s*2' } | Select-Object -First 1 }
if (-not $pick) { $pick = $fit[0] }
$ps = $doc.DefaultPageSettings
$ps.PaperSize = $pick
$ps.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$ps.Landscape = (($W -gt $H) -ne ($pick.Width -gt $pick.Height))
$doc.PrinterSettings.Copies = [int16][math]::Max(1, $Copies)
$doc.DocumentName = 'HoloBooth'
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$img = [System.Drawing.Image]::FromFile($Image)
$doc.add_PrintPage({
  param($sender, $e)
  $g = $e.Graphics
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $b = $e.PageSettings.Bounds
  # Origin is the printable area's corner; step back over the hard margin so the image covers the whole sheet.
  $g.DrawImage($img, [single](-$e.PageSettings.HardMarginX), [single](-$e.PageSettings.HardMarginY), [single]$b.Width, [single]$b.Height)
  $e.HasMorePages = $false
})
try { $doc.Print() } finally { $img.Dispose() }
Write-Output ("OK {0}|{1}x{2}|landscape={3}" -f $pick.PaperName, $pick.Width, $pick.Height, $ps.Landscape)
`;

let scriptPath = null;
function ensureScript() {
  if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holobooth-print-'));
  scriptPath = path.join(dir, 'print.ps1');
  // UTF-8 with BOM, so Windows PowerShell 5.1 reads non-ASCII printer names right.
  fs.writeFileSync(scriptPath, '﻿' + SCRIPT);
  return scriptPath;
}

function runPs(args, timeout = 90000) {
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ensureScript(), ...args],
      { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        const out = String(stdout || '').trim();
        resolve({ err, out, stderr: String(stderr || '').trim() });
      });
  });
}

/** The printer's own paper sizes: [{ name, widthIn, heightIn }]. */
async function paperSizes(printer) {
  const { out } = await runPs(['-Printer', printer, '-List'], 30000);
  return out.split(/\r?\n/).filter(l => l.startsWith('SIZE ')).map(l => {
    const [name, w, h] = l.slice(5).split('|');
    return { name, widthIn: +w / 100, heightIn: +h / 100 };
  });
}

async function printWindows({ dataUrl, widthIn, heightIn, printer, copies = 1, paperHint = '' }) {
  const ext = /^data:image\/png/.test(dataUrl) ? 'png' : 'jpg';
  const img = path.join(os.tmpdir(), `holobooth-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`);
  fs.writeFileSync(img, Buffer.from(String(dataUrl).split(',')[1] || '', 'base64'));
  try {
    const args = ['-Printer', printer, '-Image', img, '-W', String(widthIn), '-H', String(heightIn), '-Copies', String(copies)];
    if (paperHint) args.push('-Hint', paperHint);
    const { err, out, stderr } = await runPs(args);
    const ok = out.split(/\r?\n/).find(l => l.startsWith('OK '));
    if (ok) return { ok: true, reason: null, paper: ok.slice(3) };
    const msg = out.split(/\r?\n/).find(l => l.startsWith('ERR '))?.slice(4)
      || stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' ') || err?.message || 'unknown error';
    return { ok: false, reason: msg };
  } finally {
    setTimeout(() => fs.rm(img, { force: true }, () => {}), 60000);
  }
}

module.exports = { printWindows, paperSizes, SCRIPT };
