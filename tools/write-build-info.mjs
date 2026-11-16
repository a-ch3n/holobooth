/**
 * write-build-info.mjs: runs before `npm run dist`. Writes the commit and
 * build time to electron/build-info.json, so a packaged (installed) app's
 * build stamp says which code it is. A source checkout reads .git instead.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let commit = null, dirty = false;
try {
  commit = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
  dirty = execSync('git status --porcelain', { cwd: ROOT }).toString().trim() !== '';
} catch {}
const info = { commit, dirty, time: new Date().toISOString() };
writeFileSync(join(ROOT, 'electron', 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log('build-info:', JSON.stringify(info));
