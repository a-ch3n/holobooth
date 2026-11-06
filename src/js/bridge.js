/**
 * bridge.js — one `window.booth` API, three backends.
 *
 * The kiosk UI never knows what it's running on:
 *
 *   Electron desktop  → the preload script already installed window.booth
 *   Raspberry Pi      → Chromium kiosk talking JSON-RPC to the local Node service
 *   Plain browser     → system print dialog plus in-memory storage
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
    cameras: {
      remember: (role, device) => call('cameras.remember', { role, ...device }),
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
    stills: {
      status: () => call('stills.status'),
      liveview: () => call('stills.liveview'),
      capture: () => call('stills.capture'),
    },
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
  // Browser preview is always a test: mock payments.
  const cfg = fetch('../config/booth.config.json').then(r => r.json())
    .then(c => ({ ...c, payments: { ...c.payments, realProvider: c.payments?.provider, provider: 'mock', testMode: true } }));
  return {
    config: { get: () => cfg, save: async () => true, reload: async () => cfg },
    printers: {
      list: async () => [],
      print: async args => {
        const { printing } = await cfg;
        if (printing?.enabled === false) {
          return { ok: false, reason: 'Printing is disabled in booth.config.json' };
        }
        return printInBrowser(args);
      },
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

/** Plain browser preview: the system print dialog, same 4x6 page CSS as the Electron print page. */
function printInBrowser({ dataUrl, copies = 1 } = {}) {
  if (!dataUrl) return Promise.reject(new Error('Print requires an image'));
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.onerror = () => reject(new Error('Print image failed to load'));
    probe.onload = () => {
      const landscape = probe.naturalWidth > probe.naturalHeight;
      const [w, h] = landscape ? ['6in', '4in'] : ['4in', '6in'];
      const frame = document.createElement('iframe');
      Object.assign(frame.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0', border: '0' });
      frame.onload = () => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
          setTimeout(() => frame.remove(), 1000);
          resolve({ ok: true, browser: true, copies });
        } catch (error) {
          frame.remove();
          reject(error);
        }
      };
      const pages = Array.from({ length: Math.max(1, copies) }, () =>
        `<img src="${dataUrl}" style="width:${w};height:${h}">`).join('');
      frame.srcdoc = `<!doctype html><html><head><style>
        @page { size: ${w} ${h}; margin: 0 }
        html, body { margin: 0; padding: 0 }
        img { display: block; object-fit: cover }
      </style></head><body>${pages}</body></html>`;
      document.body.append(frame);
    };
    probe.src = dataUrl;
  });
}

function countBy(rows, key) {
  return rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] || 0) + 1), m), {});
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
