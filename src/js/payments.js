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

/**
 * Once the server is on the internet it only takes orders from a kiosk that
 * knows its KIOSK_KEY (config/booth.config.local.json → server.kioskKey,
 * never the committed config — the repo is public).
 */
export const kioskHeaders = key => ({ 'content-type': 'application/json', ...(key ? { 'x-kiosk-key': key } : {}) });

export function createPaymentProvider(cfg, { onStatus = () => {} } = {}) {
  // payments.offerQr: the card reader AND a QR code on the same screen —
  // the customer taps or scans, whichever they like; first one paid wins.
  if (cfg?.offerQr && ['stripe-smart-reader', 'stripe-terminal'].includes(cfg.provider)) {
    return new ReaderOrQrProvider(cfg, onStatus);
  }
  switch (cfg?.provider) {
    case 'stripe-terminal':
    case 'stripe-smart-reader': return new StripeTerminalProvider(cfg, onStatus);
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
 *
 * 'stripe-smart-reader' (WisePOS E / S700) uses this exact same class: from
 * the kiosk's side the flow is identical — create a session, poll it. The
 * only difference is on the server, which pushes the sale straight to the
 * internet-connected reader instead of waiting for a phone to pick it up.
 */
class StripeTerminalProvider extends BaseProvider {
  constructor(cfg, onStatus) {
    super(cfg, onStatus);
    this.base = cfg.serverUrl;
    this.boothId = cfg.boothId;
    this.simulated = cfg.provider === 'stripe-smart-reader' && !!cfg.stripe?.simulated;
    this.waitingMessage = this.simulated ? 'Simulated reader — press T to tap a card, D to decline'
      : cfg.provider === 'stripe-smart-reader' ? 'Tap, insert or swipe your card on the reader'
      : 'Waiting on the phone paired to the reader…';
  }

  /** Test mode only: stands in for a customer tapping the simulated reader. */
  simulateTap(decline = false) {
    if (!this.simulated) return Promise.resolve();
    // 4000000000000002 is Stripe's always-declines test card.
    return this.api('POST', '/terminal/simulate-tap', decline ? { card: '4000000000000002' } : {});
  }

  async collect(product, meta = {}) {
    this.cancelled = false;

    // The server looks the price up by productId from its own copy of
    // booth.config.json — it doesn't trust amount/description from here.
    const session = await this.api('POST', '/sessions', {
      productId: product.id, expectedAmount: product.amount, boothId: this.boothId, metadata: meta,
    });

    this.onStatus({ phase: 'ready', message: this.simulated ? this.waitingMessage : 'Tap, insert or swipe your card on the reader' });

    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (this.cancelled) return this.cancelSale(session, product, 'cancelled');
      await sleep(1500);
      const st = await this.api('GET', `/sessions/${session.sessionId}`);

      if (st.status === 'paid') {
        return {
          ok: true, method: 'card_present', paymentId: session.sessionId, paymentIntentId: session.sessionId, amount: product.amount,
          brand: st.brand || null, last4: st.last4 || null,
        };
      }
      if (st.status === 'failed') return { ok: false, declined: true, error: st.error || 'Card declined' };
      this.onStatus({ phase: 'waiting', message: this.waitingMessage });
    }
    return this.cancelSale(session, product, 'Timed out waiting for the card reader');
  }

  /** Cancels the sale — unless the card was approved in that same instant, then it's a sale. */
  async cancelSale(session, product, error) {
    const c = await this.api('POST', `/sessions/${session.sessionId}/cancel`).catch(() => null);
    if (c?.paid) {
      return { ok: true, method: 'card_present', paymentId: session.sessionId, paymentIntentId: session.sessionId,
        amount: product.amount, brand: c.brand || null, last4: c.last4 || null };
    }
    return { ok: false, error };
  }

  async api(method, path, body) {
    const res = await fetch(this.base + path, {
      method,
      headers: kioskHeaders(this.cfg.kioskKey),
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
      headers: kioskHeaders(this.cfg.kioskKey),
      body: JSON.stringify({ productId: product.id, expectedAmount: product.amount, meta }),
    });
    if (!res.ok) throw new Error(`/checkout/session: ${res.status} ${await res.text()}`);
    const { sessionId, url } = await res.json();

    this.onStatus({ phase: 'qr', message: 'Scan to pay with your phone', qrUrl: url });

    const paid = st => ({ ok: true, method: 'qr', paymentId: sessionId, paymentIntentId: st.paymentIntentId || null, amount: product.amount });
    const deadline = Date.now() + (this.cfg.qr?.timeoutMs || 180000);
    while (Date.now() < deadline) {
      if (this.cancelled) return this.expire(sessionId, paid, 'cancelled');
      await sleep(this.cfg.qr?.pollIntervalMs || 1500);
      const st = await (await fetch(`${this.cfg.serverUrl}/checkout/session/${sessionId}`, { headers: kioskHeaders(this.cfg.kioskKey) })).json();
      if (st.paid) return paid(st);
      if (st.expired) return { ok: false, error: 'Checkout expired' };
    }
    return this.expire(sessionId, paid, 'Timed out — no payment received');
  }

  /** Kills the QR link so it can't be paid later — unless it was just paid, then it's a sale. */
  async expire(sessionId, paid, error) {
    const st = await fetch(`${this.cfg.serverUrl}/checkout/session/${sessionId}/expire`, { method: 'POST', headers: kioskHeaders(this.cfg.kioskKey) })
      .then(r => r.json()).catch(() => null);
    return st?.paid ? paid(st) : { ok: false, error };
  }
}

/* ------------------------------------------------- reader + QR, together */

/**
 * The WisePOS E (or M2) and a QR code on one screen. Both run at once; the
 * first payment to complete is the sale and the other is cancelled — the
 * reader cleared, the QR link expired so it can't be paid later. Cancelling
 * reports a payment that landed in that same instant, and any such second
 * payment is refunded on the spot, so a customer is never charged twice.
 * If one side can't start (reader offline, say), the other carries on alone.
 */
class ReaderOrQrProvider extends BaseProvider {
  constructor(cfg, onStatus) {
    super(cfg, onStatus);
    this.reader = new StripeTerminalProvider(cfg, () => {});
    this.qr = new StripeQrProvider(cfg, () => {});
  }

  async init() { await Promise.allSettled([this.reader.init(), this.qr.init()]); }

  cancel() {
    super.cancel();
    this.reader.cancel();
    this.qr.cancel();
  }

  async collect(product, meta = {}) {
    this.cancelled = false;
    this.done = false;
    let qrUrl = null, readerUp = true, qrUp = true, declined = null;
    const show = () => this.onStatus({
      phase: qrUrl ? 'qr' : 'ready',
      qrUrl,
      message: readerUp && qrUrl ? `${declined ? `${declined} — try another card` : this.reader.simulated ? 'Simulated reader: T to tap, D to decline' : 'Tap, insert or swipe your card on the reader'} — or scan the code to pay on your phone`
        : qrUrl ? 'Scan the code to pay on your phone'
        : readerUp ? this.reader.waitingMessage : 'Starting payment…',
    });
    this.qr.onStatus = s => { if (s.qrUrl) { qrUrl = s.qrUrl; show(); } };
    show();

    // A declined card puts a fresh sale back on the reader, so the customer
    // can try another card (up to 3) while the QR code stays up.
    const readerLoop = async () => {
      for (let tries = 1; ; tries++) {
        const r = await this.reader.collect(product, meta).catch(e => ({ ok: false, error: e.message }));
        if (r.ok || !r.declined || this.cancelled || this.done || tries >= 3) return r;
        declined = String(r.error).replace(/\.\s*$/, '');
        show();
      }
    };
    const sides = [
      { name: 'reader', p: readerLoop() },
      { name: 'qr', p: this.qr.collect(product, meta).catch(e => ({ ok: false, error: e.message })) },
    ];
    sides.forEach(side => side.p.then(r => {
      if (r.ok || this.cancelled) return;
      // One side failed to start or declined: the other keeps going.
      if (side.name === 'reader') readerUp = false; else qrUp = false;
      if (readerUp || qrUp) show();
    }));

    // First success wins; if both fail, report the reader's reason (it's the
    // one a customer at a card machine is most likely to have tried).
    const first = await new Promise(resolve => {
      let left = sides.length;
      sides.forEach(side => side.p.then(r => {
        if (r.ok) resolve({ side, r });
        else if (--left === 0) resolve(null);
      }));
    });

    if (!first) {
      const [rr, qr] = await Promise.all(sides.map(s => s.p));
      if (this.cancelled) return { ok: false, error: 'cancelled' };
      return { ok: false, error: rr.error === 'cancelled' ? qr.error : rr.error || qr.error };
    }

    // Stop the other side, then make sure it didn't also take a payment.
    this.done = true;
    const other = sides.find(s => s !== first.side);
    (other.name === 'reader' ? this.reader : this.qr).cancel();
    const late = await other.p;
    if (late.ok) await this.refund(late, 'paid twice — kept the first payment');
    if (this.cancelled) {
      // The customer hit Cancel, but a payment landed anyway: give it back.
      await this.refund(first.r, 'cancelled at the moment of payment');
      return { ok: false, error: 'cancelled' };
    }
    return first.r;
  }

  async refund(result, why) {
    console.warn(`[payments] refunding ${result.method} ${result.paymentId}: ${why}`);
    if (!result.paymentIntentId) {
      console.error(`[payments] can't refund ${result.paymentId} automatically (no PaymentIntent id) — refund it in the Stripe Dashboard`);
      return;
    }
    await fetch(`${this.cfg.serverUrl}/terminal/refund`, {
      method: 'POST', headers: kioskHeaders(this.cfg.kioskKey),
      body: JSON.stringify({ paymentIntentId: result.paymentIntentId }),
    }).catch(e => console.error(`[payments] refund of ${result.paymentIntentId} failed: ${e.message} — refund it in the Stripe Dashboard`));
  }

  simulateTap(decline) { return this.reader.simulateTap(decline); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
