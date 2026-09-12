import crypto from 'node:crypto';
import config from '../config.js';

const PAYSTACK_BASE = 'https://api.paystack.co';

export function isMock() {
  return config.paystackMode === 'mock';
}

export function newReference() {
  return `pap_${crypto.randomBytes(10).toString('hex')}`;
}

export function verifyWebhookSignature(rawBody, signature) {
  if (!config.paystackSecretKey) return false;
  if (typeof signature !== 'string' || signature.length === 0) return false;
  const expected = crypto
    .createHmac('sha512', config.paystackSecretKey)
    .update(rawBody)
    .digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function paystackFetch(pathname, { method, body } = {}) {
  const res = await fetch(`${PAYSTACK_BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.paystackSecretKey}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) {
    const detail = data.message || `HTTP ${res.status}`;
    throw new Error(`Paystack ${pathname} failed: ${detail}`);
  }
  return data;
}

export async function initializeTransaction({ email, amountKobo, reference, callbackUrl, metadata }) {
  if (isMock()) {
    return { authorizationUrl: `/mock-checkout?reference=${encodeURIComponent(reference)}`, reference };
  }
  const data = await paystackFetch('/transaction/initialize', {
    method: 'POST',
    body: {
      email,
      amount: amountKobo,
      currency: 'NGN',
      reference,
      callback_url: callbackUrl,
      metadata,
    },
  });
  return { authorizationUrl: data.data.authorization_url, reference: data.data.reference };
}

// In mock mode fulfillment is recorded directly by the mock charge endpoint,
// so live verification is a no-op.
export async function verifyTransaction(reference) {
  if (isMock()) return null;
  const data = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`, {
    method: 'GET',
  });
  const t = data.data;
  return {
    status: t.status === 'success' ? 'success' : t.status === 'failed' ? 'failed' : 'pending',
    amountKobo: t.amount,
    paidAt: t.paid_at ?? null,
  };
}
