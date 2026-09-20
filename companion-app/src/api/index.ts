/**
 * Talks to the same server/index.js this repo's Electron app talks to.
 * Three calls, matching the three things a Bluetooth-only M2 needs a phone
 * for: getting a Terminal connection token, finding the sale HoloBooth is
 * waiting to collect, and telling the server once the tap is confirmed so
 * it can capture the PaymentIntent.
 */

export type Settings = {
  serverUrl: string;
  boothId: string;
  appKey: string;
  /** Stripe Terminal Location id (tml_...) the M2 was registered under — same one as booth.config.json's payments.stripe.locationId. */
  locationId: string;
};

export type PendingSale = {
  id: string;
  amount: number;
  currency: string;
  clientSecret: string;
} | null;

async function call<T>(settings: Settings, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${settings.serverUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(settings.appKey ? { 'x-app-key': settings.appKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path}: ${res.status} ${text}`);
  }
  return res.json();
}

/** Terminal SDK's tokenProvider calls this every time it needs a fresh connection token. */
export function fetchConnectionToken(settings: Settings) {
  return call<{ secret: string }>(settings, 'POST', '/terminal/connection_token').then(r => r.secret);
}

/** Poll this. A non-null result is the one sale currently waiting on this booth's M2. */
export function fetchPendingSale(settings: Settings) {
  return call<{ pending: PendingSale }>(settings, 'GET', `/booths/${encodeURIComponent(settings.boothId)}/pending`)
    .then(r => r.pending);
}

/** Call once the SDK confirms the PaymentIntent — this is what actually captures the funds. */
export function captureSale(settings: Settings, sessionId: string) {
  return call<{ status: string }>(settings, 'POST', `/sessions/${encodeURIComponent(sessionId)}/capture`);
}
