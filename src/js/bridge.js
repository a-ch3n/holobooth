/**
 * bridge.js — one `window.booth` API, three backends.
 *
 * The kiosk UI never knows what it's running on:
 *
 *   Electron desktop  → the preload script already installed window.booth
 *   Raspberry Pi      → Chromium kiosk talking JSON-RPC to the local Node service
 *   Plain browser     → in-memory stub, so `npm run web` works with no hardware
 *
 * That's the whole reason the Pi port didn't need the app rewritten: the state
 * machine calls the same eight namespaces either way, and only this file knows
 * where they actually go.
 */

export const PLATFORMS = { ELECTRON: 'electron', PI: 'pi', BROWSER: 'browser' };

export async function installBridge({ apiBase = '' } = {}) {
  // 1. Electron preload wins — it's already there and it's the fastest path.
  if (window.booth) return PLATFORMS.ELECTRON;

  // 2. Pi kiosk service. Short timeout: if it isn't there we want the browser
  //    stub immediately, not a five-second stall on the attract screen.
  const svc = await probe(`${apiBase}/api/health`, 1500);
  if (svc?.ok) {
    window.booth = makeRpcBridge(apiBase);
    window.booth.__platform = svc.platform || PLATFORMS.PI;
    return svc.platform || PLATFORMS.PI;
  }

  // 3. Browser preview.
  console.warn('[holobooth] no kiosk service — running in browser preview mode');
  window.booth = makeMemoryBridge();
  return PLATFORMS.BROWSER;
}

async function probe(url, ms) {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

/* --------------------------------------------------------------- Pi RPC */

function makeRpcBridge(apiBase) {
  const call = async (method, args) => {
    const res = await fetch(`${apiBase}/api/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, args }),
    });
    if (!res.ok) throw new Error(`${method}: ${res.status} ${await res.text()}`);
    const body = await res.json();
    if (body.error) throw new Error(body.error);
    return body.result;
  };

  return {
    config: {
      get: () => call('config.get'),
      save: next => call('config.save', next),
      reload: () => call('config.reload'),
    },
    printers: {
      list: () => call('printers.list'),
      print: args => call('printers.print', args),
    },
    cards: {
      nextMint: args => call('cards.nextMint', args),
      record: card => call('cards.record', card),
      stats: args => call('cards.stats', args),
    },
    sales: {
      record: sale => call('sales.record', sale),
      summary: () => call('sales.summary'),
    },
    media: { save: args => call('media.save', args) },
    app: {
      info: () => call('app.info'),
      quit: () => call('app.quit'),
      reload: () => location.reload(),
    },
    /**
     * Physical buttons. The Pi service pushes GPIO events over SSE, so an
     * arcade shutter button or a coin acceptor can drive the same flow as the
     * touchscreen. No-op on the other platforms.
     */
    input: {
      subscribe(handler) {
        try {
          const es = new EventSource(`${apiBase}/api/input`);
          es.addEventListener('button', e => handler(JSON.parse(e.data)));
          es.onerror = () => {};
          return () => es.close();
        } catch { return () => {}; }
      },
    },
  };
}

/* ------------------------------------------------------------- in-memory */

function makeMemoryBridge() {
  const mem = { cards: [], sales: [] };
  const cfg = fetch('../config/booth.config.json').then(r => r.json());
  return {
    config: { get: () => cfg, save: async () => true, reload: async () => cfg },
    printers: {
      list: async () => [],
      print: async () => ({ ok: false, reason: 'Printing is disabled in browser preview' }),
    },
    cards: {
      nextMint: async ({ frameId }) => mem.cards.filter(c => c.frameId === frameId).length + 1,
      record: async c => { mem.cards.push(c); return true; },
      stats: async () => ({
        total: mem.cards.length,
        byFrame: {}, byRarity: countBy(mem.cards, 'rarity'),
        recent: mem.cards.slice(-12).reverse(),
      }),
    },
    sales: {
      record: async s => { mem.sales.push(s); return true; },
      summary: async () => ({
        todayCount: mem.sales.length,
        todayGross: mem.sales.reduce((t, s) => t + (s.amount || 0), 0),
        allCount: mem.sales.length,
        allGross: mem.sales.reduce((t, s) => t + (s.amount || 0), 0),
        byProduct: countBy(mem.sales, 'productId'),
      }),
    },
    media: { save: async () => null },
    app: {
      info: async () => ({ version: 'browser-preview', platform: 'web', dev: true }),
      quit: async () => {},
      reload: () => location.reload(),
    },
    input: { subscribe: () => () => {} },
  };
}

function countBy(rows, key) {
  return rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] || 0) + 1), m), {});
}
