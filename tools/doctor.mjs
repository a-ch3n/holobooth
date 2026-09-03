/**
 * Preflight check. Run this when something won't start — it tells you which
 * of the four usual suspects it is instead of making you guess.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const line = (ok, label, hint) =>
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${!ok && hint ? `\n      → ${hint}` : ''}`);

console.log('\nHoloBooth doctor\n');

const nodeMajor = Number(process.versions.node.split('.')[0]);
line(nodeMajor >= 18, `node ${process.versions.node}`, 'Install Node 18 or newer (Electron 31 needs it).');

const hasModules = existsSync(join(root, 'node_modules'));
line(hasModules, 'node_modules present', 'Run: npm install');

const electronPkg = join(root, 'node_modules', 'electron');
const hasElectron = existsSync(electronPkg);
line(hasElectron, 'electron package installed',
  'Run: npm install    (electron is a devDependency — `npm install --production` or NODE_ENV=production will skip it)');

// The classic failure: the package installs but its postinstall binary download
// fails, leaving a package with no actual Electron in it.
if (hasElectron) {
  const pathFile = join(electronPkg, 'path.txt');
  const distOk = existsSync(join(electronPkg, 'dist')) && existsSync(pathFile);
  line(distOk, 'electron binary downloaded',
    'The postinstall download failed. Run: node node_modules/electron/install.js');
  if (distOk) {
    const rel = readFileSync(pathFile, 'utf8').trim();
    line(existsSync(join(electronPkg, 'dist', rel)), `binary at dist/${rel}`,
      'Delete node_modules/electron and reinstall.');
  }
}

line(existsSync(join(root, 'node_modules', '.bin', 'electron')), 'electron on the local PATH',
  'npm run dev uses node_modules/.bin. If this is missing, reinstall.');

for (const f of ['config/booth.config.json', 'src/index.html', 'src/js/app.js', 'src/js/frames/packs.mjs']) {
  line(existsSync(join(root, f)), f, 'File is missing from the checkout.');
}

try {
  const cfg = JSON.parse(readFileSync(join(root, 'config', 'booth.config.json'), 'utf8'));
  line(true, `config parses — booth ${cfg.booth?.id}, payments: ${cfg.payments?.provider}`);
} catch (e) {
  line(false, 'config parses', e.message);
}

try {
  execSync('which sips || which magick || true', { stdio: 'ignore' });
} catch {}

console.log(`\nIf everything above is ✓ and Electron still won't start, run it directly:\n  ./node_modules/.bin/electron .\n`);
console.log(`No Electron? You can run the whole kiosk flow in a browser instead:\n  npm run web\n`);
