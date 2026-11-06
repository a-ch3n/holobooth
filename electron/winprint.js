/**
 * winprint.js — Windows printer helpers for the XPS print method and the
 * operator panel: the driver's paper sizes, the XPS print itself
 * (winprint-xps.ps1), and what Windows says about the queue afterwards.
 *
 * The default Windows print path is Chromium's (electron/main.js). This is
 * the fallback: printing.windowsMethod "xps", the same path Ctrl+P photo
 * printing uses.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

// Lists the driver's own paper sizes (PaperSize is in hundredths of an inch).
const SCRIPT = String.raw`
param([string]$Printer)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $Printer
if (-not $doc.PrinterSettings.IsValid) { Write-Output "ERR Printer not found: $Printer"; exit 2 }
foreach ($s in @($doc.PrinterSettings.PaperSizes)) { Write-Output ("SIZE {0}|{1}|{2}" -f $s.PaperName, $s.Width, $s.Height) }
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
  const { out } = await runPs(['-Printer', printer], 30000);
  return out.split(/\r?\n/).filter(l => l.startsWith('SIZE ')).map(l => {
    const [name, w, h] = l.slice(5).split('|');
    return { name, widthIn: +w / 100, heightIn: +h / 100 };
  });
}

const DIAG = `
$ErrorActionPreference = 'SilentlyContinue'
$printers = @(Get-Printer | ForEach-Object { [pscustomobject]@{ name = $_.Name; port = $_.PortName; driver = $_.DriverName; status = "$($_.PrinterStatus)"; default = $false } })
$def = (Get-CimInstance -ClassName Win32_Printer -Filter 'Default=TRUE').Name
foreach ($p in $printers) { if ($p.name -eq $def) { $p.default = $true } }
$jobs = @(foreach ($p in Get-Printer) { Get-PrintJob -PrinterName $p.Name | ForEach-Object { [pscustomobject]@{ printer = $p.Name; id = $_.Id; doc = $_.DocumentName; status = "$($_.JobStatus)"; submitted = "$($_.SubmittedTime)" } } })
$ports = @(Get-PrinterPort | Where-Object { $_.Name -like 'USB*' -or $_.Name -like 'DOT4*' } | ForEach-Object { [pscustomobject]@{ name = $_.Name; description = $_.Description } })
[pscustomobject]@{ printers = $printers; jobs = $jobs; usbPorts = $ports } | ConvertTo-Json -Depth 4 -Compress
`;

function diagnose() {
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', DIAG],
      { timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        const out = String(stdout || '').trim();
        try { resolve({ ok: true, ...JSON.parse(out.slice(out.indexOf('{'))) }); }
        catch { resolve({ ok: false, error: (String(stderr || '').trim() || err?.message || out || 'no output').slice(0, 500) }); }
      });
  });
}

/** One line for the log: the printer's port/status and its queue. */
function summarize(d, focus) {
  if (!d.ok) return `printer check failed: ${d.error}`;
  const arr = v => (Array.isArray(v) ? v : v ? [v] : []);
  const printers = arr(d.printers).filter(p => !focus || /DS|DNP|Citizen|SELPHY/i.test(p.name) || p.name === focus);
  const jobs = arr(d.jobs);
  return [
    ...printers.map(p => `printer "${p.name}" port=${p.port} status=${p.status}${p.default ? ' (Windows default)' : ''} driver=${p.driver}`),
    jobs.length ? `queue: ${jobs.map(j => `[${j.printer}] #${j.id} "${j.doc}" ${j.status}`).join('; ')}` : 'queue: empty (no jobs waiting)',
    `usb ports: ${arr(d.usbPorts).map(p => `${p.name}${p.description ? ` (${p.description})` : ''}`).join(', ') || 'none'}`,
  ].join('\n');
}

/**
 * Print through Windows' XPS path (electron/winprint-xps.ps1): the same one
 * Ctrl+P photo printing uses. Starts from the printer's Printing Preferences, so
 * each Windows printer entry's paper and 2inch-cut setting apply.
 */
let xpsScript = null;
function ensureXpsScript() {
  if (xpsScript && fs.existsSync(xpsScript)) return xpsScript;
  // Copied out to a temp file: PowerShell can't run a script inside app.asar.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holobooth-xps-'));
  xpsScript = path.join(dir, 'winprint-xps.ps1');
  fs.writeFileSync(xpsScript, '\ufeff' + fs.readFileSync(path.join(__dirname, 'winprint-xps.ps1'), 'utf8'));
  return xpsScript;
}

/** file: the page image on disk (the saved PNG). widthIn/heightIn: the 4x6 sheet, either way round. */
async function printXps({ file, widthIn, heightIn, printer, copies = 1, turn = 'right' }) {
  const out = await new Promise(resolve => {
    execFile('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ensureXpsScript(),
      '-Printer', printer, '-Image', file, '-W', String(widthIn), '-H', String(heightIn), '-Copies', String(copies), '-Turn', turn === 'left' ? 'left' : 'right'],
    { timeout: 120000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ err, out: String(stdout || '').trim(), stderr: String(stderr || '').trim() }));
  });
  const ok = out.out.split(/\r?\n/).find(l => l.startsWith('OK '));
  if (ok) return { ok: true, reason: null, paper: ok.slice(3) };
  const msg = out.out.split(/\r?\n/).find(l => l.startsWith('ERR '))?.slice(4)
    || out.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' ') || out.err?.message || 'unknown error';
  return { ok: false, reason: `XPS print: ${msg}` };
}

module.exports = { printXps, paperSizes, diagnose, summarize, SCRIPT };
