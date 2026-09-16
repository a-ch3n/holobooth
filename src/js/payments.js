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
 * Server-driven Terminal flow:
 *   kiosk -> your server -> Stripe (create PaymentIntent)
 *   kiosk -> your server -> Stripe (process_payment_intent on the reader)
 *   reader prompts, customer taps, kiosk polls until succeeded
 *
 * The secret key never leaves your server. The kiosk only ever holds ids.
 */
class StripeTerminalProvider extends BaseProvider {
  constructor(cfg, onStatus) {
    super(cfg, onStatus);
    this.base = cfg.serverUrl;
    this.readerId = null;
  }

  async init() {
    const readers = await this.api('GET', '/terminal/readers');
    if (!readers.length) throw new Error('No Stripe Terminal readers registered at this location.');
    const wanted = this.cfg.stripe?.readerLabel;
    this.reader = (wanted && readers.find(r => r.label === wanted)) || readers[0];
    this.readerId = this.reader.id;
    this.onStatus({ phase: 'idle', message: `Reader: ${this.reader.label} (${this.reader.status})` });
    return this.reader;
  }

  async collect(product, meta = {}) {
    this.cancelled = false;
    if (!this.readerId) await this.init();

    const intent = await this.api('POST', '/terminal/payment_intent', {
      amount: product.amount,
      currency: this.cfg.currency || 'usd',
      description: `${product.name} — HoloBooth`,
      metadata: { productId: product.id, ...meta },
    });

    this.onStatus({ phase: 'ready', message: 'Tap, insert or swipe your card' });
    await this.api('POST', '/terminal/process', { readerId: this.readerId, paymentIntentId: intent.id });

    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (this.cancelled) {
        await this.api('POST', '/terminal/cancel_action', { readerId: this.readerId }).catch(() => {});
        return { ok: false, error: 'cancelled' };
      }
      await sleep(1200);
      const st = await this.api('GET', `/terminal/payment_intent/${intent.id}`);

      if (st.status === 'requires_capture' || st.status === 'succeeded') {
        this.onStatus({ phase: 'processing', message: 'Approved' });
        if (st.status === 'requires_capture') await this.api('POST', '/terminal/capture', { paymentIntentId: intent.id });
        const charge = st.latest_charge_details || {};
        return {
          ok: true, method: 'card_present', paymentId: intent.id, amount: product.amount,
          brand: charge.brand || null, last4: charge.last4 || null,
        };
      }
      if (st.status === 'canceled') return { ok: false, error: 'Payment cancelled' };
      if (st.last_payment_error) return { ok: false, error: st.last_payment_error.message || 'Card declined' };
      this.onStatus({ phase: 'waiting', message: readerPrompt(st.status) });
    }
    await this.api('POST', '/terminal/cancel_action', { readerId: this.readerId }).catch(() => {});
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

function readerPrompt(status) {
  return {
    requires_payment_method: 'Waiting for card…',
    requires_confirmation: 'Confirming…',
    processing: 'Processing…',
  }[status] || 'Follow the prompts on the reader';
}

/* --------------------------------------------------------- stripe QR  */

/** Customer pays on their own phone; kiosk shows a QR and polls for the result. */
class StripeQrProvider extends BaseProvider {
  async collect(product, meta = {}) {
    this.cancelled = false;
    const res = await fetch(this.cfg.serverUrl + '/checkout/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: product.amount, productId: product.id, meta }),
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
