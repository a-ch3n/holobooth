/**
 * payments.js — one interface, three providers.
 *
 * Every provider resolves to { ok, paymentId, method, amount, error }. The UI
 * never branches on provider, so you can develop on `mock`, demo on `stripe-qr`
 * and run the event on `stripe-terminal` without touching the flow.
 *
 * Card-present (Terminal) is the right default for a booth: lower fees than
 * online rates, no customer typing on a shared screen, and it works when the
 * venue wifi is flaky because the reader retries.
 */

export function createPaymentProvider(cfg, { onStatus = () => {} } = {}) {
  switch (cfg?.provider) {
    case 'stripe-terminal': return new StripeTerminalProvider(cfg, onStatus);
    case 'stripe-qr': return new StripeQrProvider(cfg, onStatus);
    default: return new MockProvider(cfg, onStatus);
  }
}

class BaseProvider {
  constructor(cfg, onStatus) { this.cfg = cfg; this.onStatus = onStatus; this.cancelled = false; }
  async init() {}
  cancel() { this.cancelled = true; }
  async collect() { throw new Error('not implemented'); }
}

/* ---------------------------------------------------------------- mock */

/** Development provider. Approves after a beat; press "d" to force a decline. */
class MockProvider extends BaseProvider {
  async collect(product) {
    this.cancelled = false;
    this.onStatus({ phase: 'ready', message: 'Tap or insert card (mock reader)' });
    for (let i = 0; i < 18; i++) {
      if (this.cancelled) return { ok: false, error: 'cancelled' };
      await sleep(100);
    }
    this.onStatus({ phase: 'processing', message: 'Approving…' });
    await sleep(600);
    if (window.__forceDecline) {
      window.__forceDecline = false;
      return { ok: false, error: 'Card declined (simulated)' };
    }
    return {
      ok: true, method: 'mock',
      paymentId: 'mock_' + Math.random().toString(36).slice(2, 10),
      amount: product.amount, brand: 'visa', last4: '4242',
    };
  }
}

/* ---------------------------------------------------- stripe terminal  */

/**
 * M2 + companion-phone flow:
 *   kiosk -> your server: "sell productId to boothId" — creates the PaymentIntent
 *   phone -> your server: polls for the pending sale, then drives the M2
 *            itself over Bluetooth via the Stripe Terminal SDK
 *   kiosk -> your server: polls that same session until it flips to paid
 *
 * An M2 is Bluetooth-only, so the kiosk can't talk to it directly — that's
 * why a phone is in the loop at all. The secret key still never reaches
 * either the kiosk or the phone; both only ever hold ids.
 */
class StripeTerminalProvider extends BaseProvider {
  constructor(cfg, onStatus) {
    super(cfg, onStatus);
    this.base = cfg.serverUrl;
    this.boothId = cfg.boothId;
  }

  async collect(product, meta = {}) {
    this.cancelled = false;

    // The server looks the price up by productId from its own copy of
    // booth.config.json — it doesn't trust amount/description from here.
    const session = await this.api('POST', '/sessions', {
      productId: product.id, boothId: this.boothId, metadata: meta,
    });

    this.onStatus({ phase: 'ready', message: 'Tap, insert or swipe your card on the reader' });

    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (this.cancelled) {
        await this.api('POST', `/sessions/${session.sessionId}/cancel`).catch(() => {});
        return { ok: false, error: 'cancelled' };
      }
      await sleep(1500);
      const st = await this.api('GET', `/sessions/${session.sessionId}`);

      if (st.status === 'paid') {
        return {
          ok: true, method: 'card_present', paymentId: session.sessionId, amount: product.amount,
          brand: st.brand || null, last4: st.last4 || null,
        };
      }
      if (st.status === 'failed') return { ok: false, error: st.error || 'Card declined' };
      this.onStatus({ phase: 'waiting', message: 'Waiting on the phone paired to the reader…' });
    }
    await this.api('POST', `/sessions/${session.sessionId}/cancel`).catch(() => {});
    return { ok: false, error: 'Timed out waiting for the card reader' };
  }

  async api(method, path, body) {
    const res = await fetch(this.base + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }
}

/* --------------------------------------------------------- stripe QR  */

/** Customer pays on their own phone; kiosk shows a QR and polls for the result. */
class StripeQrProvider extends BaseProvider {
  async collect(product, meta = {}) {
    this.cancelled = false;
    const res = await fetch(this.cfg.serverUrl + '/checkout/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId: product.id, meta }),
    });
    const { sessionId, url } = await res.json();

    this.onStatus({ phase: 'qr', message: 'Scan to pay with your phone', qrUrl: url });

    const deadline = Date.now() + (this.cfg.qr?.timeoutMs || 180000);
    while (Date.now() < deadline) {
      if (this.cancelled) return { ok: false, error: 'cancelled' };
      await sleep(this.cfg.qr?.pollIntervalMs || 1500);
      const st = await (await fetch(`${this.cfg.serverUrl}/checkout/session/${sessionId}`)).json();
      if (st.paid) return { ok: true, method: 'qr', paymentId: sessionId, amount: product.amount };
      if (st.expired) return { ok: false, error: 'Checkout expired' };
    }
    return { ok: false, error: 'Timed out — no payment received' };
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
