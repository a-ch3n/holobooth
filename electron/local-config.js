/**
 * config/booth.config.local.json — this booth's own settings on top of the
 * committed booth.config.json. It's gitignored, because the repo is public
 * and this is where the kiosk key for the cloud server lives:
 *
 *   { "server": { "url": "https://203-0-113-5.sslip.io", "kioskKey": "…" } }
 *
 * server.url points payments, AI names and photo uploads at that one server,
 * so a booth only needs these two lines to switch to the cloud host. Any
 * other key in the file overrides the same key in booth.config.json.
 *
 * Shared by electron/main.js and pi/kiosk-server.mjs.
 */
const fs = require('node:fs');

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base?.[k]) ? deepMerge(base[k], v) : v;
  return out;
}

/** Every leaf path the local file sets, plus the ones server.url fills in. */
function overriddenPaths(local) {
  const paths = [];
  const walk = (o, pre) => {
    for (const [k, v] of Object.entries(o)) isObj(v) ? walk(v, [...pre, k]) : paths.push([...pre, k]);
  };
  walk(local, []);
  if (local.server?.url) paths.push(['payments', 'serverUrl'], ['ai', 'serverUrl'], ['delivery', 'uploadUrl'], ['delivery', 'downloadBaseUrl']);
  return paths;
}

function readLocal(localPath) {
  if (!fs.existsSync(localPath)) return null;
  try { return JSON.parse(fs.readFileSync(localPath, 'utf8')); } catch (e) {
    console.error(`[config] ignoring ${localPath}: ${e.message}`);
    return null;
  }
}

function applyLocal(base, local) {
  if (!local) return base;
  const cfg = deepMerge(base, local);
  const url = String(cfg.server?.url || '').replace(/\/+$/, '');
  if (url) {
    cfg.payments = { ...cfg.payments, serverUrl: url };
    cfg.ai = { ...cfg.ai, serverUrl: url };
    cfg.delivery = { ...cfg.delivery, uploadUrl: `${url}/media`, downloadBaseUrl: `${url}/d` };
  }
  return cfg;
}

/**
 * The inverse, for saving: puts back booth.config.json's own value at every
 * path the local file overrode, so the kiosk key (and this booth's server
 * URL) never get written into the committed file.
 */
function stripLocal(next, base, local) {
  if (!local) return next;
  const out = structuredClone(next);
  for (const p of overriddenPaths(local)) {
    const parent = p.slice(0, -1).reduce((o, k) => (isObj(o?.[k]) ? o[k] : null), out);
    if (!parent) continue;
    const key = p[p.length - 1];
    const orig = p.reduce((o, k) => (o == null ? undefined : o[k]), base);
    if (orig === undefined) delete parent[key]; else parent[key] = structuredClone(orig);
  }
  // Drop objects the local file introduced that are now empty (e.g. "server").
  for (const k of Object.keys(local)) if (!(k in base) && isObj(out[k]) && !Object.keys(out[k]).length) delete out[k];
  return out;
}

module.exports = { readLocal, applyLocal, stripLocal };
