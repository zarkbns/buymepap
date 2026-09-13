import crypto from 'node:crypto';
import { koboToMajorString, majorToKobo } from '../money.js';
import { ProviderError } from './index.js';

/**
 * Flutterwave v3 adapter. Endpoint paths are centralised here so the rest of
 * the system stays provider-agnostic; they are the one place to touch if the
 * gateway version changes. All calls are server-side: the secret key and the
 * webhook hash never leave this process.
 */
const TIMEOUT = 20000;

export class FlutterwaveProvider {
  #cfg;
  #fetch;

  constructor(cfg, { fetchImpl } = {}) {
    this.#cfg = cfg;
    this.#fetch = fetchImpl ?? globalThis.fetch;
  }

  get name() {
    return 'flutterwave';
  }

  async #request(method, path, body) {
    let res;
    try {
      res = await this.#fetch(`${this.#cfg.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.#cfg.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.#cfg.timeoutMs ?? TIMEOUT),
      });
    } catch (err) {
      throw new ProviderError(`payment gateway unreachable: ${err?.cause?.code ?? err?.name ?? 'network error'}`, {
        kind: 'network',
      });
    }
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.status === 'error' || payload.status === false) {
      throw new ProviderError(`payment gateway rejected ${method} ${path}: ${payload.message ?? `HTTP ${res.status}`}`, {
        status: res.status,
      });
    }
    return payload;
  }

  async initializePayment({ reference, amountKobo, currency, customerName, customerEmail, redirectUrl, metadata }) {
    const payload = await this.#request('POST', '/payments', {
      account_sid: this.#cfg.entitySid,
      api_public_key: this.#cfg.publicKey,
      tx_ref: reference,
      amount: koboToMajorString(amountKobo),
      currency,
      redirect_url: redirectUrl,
      customer: { name: customerName, email: customerEmail },
      meta: metadata,
    });
    const link = payload?.data?.link;
    if (typeof link !== 'string' || !/^https?:\/\//.test(link)) {
      throw new ProviderError('payment gateway returned no checkout URL');
    }
    return { checkoutUrl: link, providerRef: null };
  }

  async verifyPayment(reference) {
    const payload = await this.#request(
      'GET',
      `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
    );
    const tx = payload?.data;
    if (!tx) return null;
    const status = tx.status === 'successful' ? 'success' : tx.status === 'failed' ? 'failed' : 'pending';
    return {
      status,
      providerRef: tx.id != null ? String(tx.id) : null,
      amountKobo: majorToKobo(tx.amount),
      currency: tx.currency,
      paidAt: tx.paid_at ?? null,
    };
  }

  #webhookSignatureValid(rawBody, headers) {
    const hash = this.#cfg.webhookHash;
    if (!hash) return false;
    const legacy = headers?.['verif-hash'];
    if (typeof legacy === 'string' && legacy.length > 0) {
      const a = Buffer.from(hash);
      const b = Buffer.from(legacy);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    const signature = headers?.['flutterwave-signature'];
    if (typeof signature === 'string' && signature.length > 0) {
      const expected = crypto.createHmac('sha256', hash).update(rawBody).digest('base64');
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    return false;
  }

  verifyWebhook(rawBody, headers) {
    if (!this.#webhookSignatureValid(rawBody, headers)) return { ok: false, event: null };
    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { ok: false, event: null };
    }
    const type = payload?.type ?? payload?.event ?? '';
    const data = payload?.data ?? {};

    if (type === 'charge.completed') {
      const status = data.status === 'successful' ? 'success' : data.status === 'failed' ? 'failed' : 'pending';
      return {
        ok: true,
        event: {
          key: payload.id != null ? `wbk:${payload.id}` : `sha:${crypto.createHash('sha256').update(rawBody).digest('hex')}`,
          type,
          reference: data.tx_ref ?? data.reference ?? null,
          providerRef: data.id != null ? String(data.id) : null,
          status,
          amountKobo: data.amount != null ? majorToKobo(data.amount) : null,
          currency: data.currency ?? null,
        },
      };
    }

    if (type === 'transfer.completed') {
      const raw = String(data.status ?? '').toUpperCase();
      const status = raw === 'SUCCESSFUL' ? 'paid' : raw === 'REVERSED' ? 'reversed' : 'failed';
      return {
        ok: true,
        event: {
          key: payload.id != null ? `wbk:${payload.id}` : `sha:${crypto.createHash('sha256').update(rawBody).digest('hex')}`,
          type,
          reference: data.reference ?? null,
          providerRef: data.id != null ? String(data.id) : null,
          status,
          amountKobo: data.amount != null ? majorToKobo(data.amount) : null,
          currency: data.currency ?? null,
        },
      };
    }

    return { ok: true, event: null };
  }

  async listBanks() {
    const payload = await this.#request('GET', '/banks?country=NG');
    const banks = Array.isArray(payload?.data) ? payload.data : [];
    return banks
      .filter((b) => b && b.code && b.name)
      .map((b) => ({ code: String(b.code), name: String(b.name) }));
  }

  async resolvePayoutAccount({ bankCode, accountNumber }) {
    const payload = await this.#request('POST', '/accounts/resolve', {
      account_bank: bankCode,
      account_number: accountNumber,
    });
    const accountName = payload?.data?.account_name;
    if (typeof accountName !== 'string' || !accountName.trim()) {
      throw new ProviderError('bank account could not be verified');
    }
    return { accountName: accountName.trim(), bankName: payload?.data?.bank_name ?? null, beneficiaryRef: null };
  }

  async initiatePayout({ reference, amountKobo, currency, bankCode, accountNumber, narration }) {
    const payload = await this.#request('POST', '/transfers', {
      account_bank: bankCode,
      account_number: accountNumber,
      amount: koboToMajorString(amountKobo),
      currency,
      reference,
      narration,
      meta: { source: 'buymepap' },
    });
    const data = payload?.data ?? {};
    const raw = String(data.status ?? '').toUpperCase();
    const status = raw === 'SUCCESSFUL' ? 'paid' : raw === 'FAILED' || raw === 'CANCELLED' ? 'failed' : 'processing';
    return {
      providerRef: data.id != null ? String(data.id) : null,
      status,
      failureReason: status === 'failed' ? (data.complete_message ?? data.provider_response?.message ?? null) : null,
    };
  }

  async fetchPayout(providerRef) {
    const payload = await this.#request('GET', `/transfers/${encodeURIComponent(providerRef)}`);
    const data = payload?.data ?? {};
    const raw = String(data.status ?? '').toUpperCase();
    const status = raw === 'SUCCESSFUL' ? 'paid' : raw === 'REVERSED' ? 'reversed' : raw === 'FAILED' || raw === 'CANCELLED' ? 'failed' : 'processing';
    return {
      status,
      failureReason: status === 'failed' ? (data.complete_message ?? null) : null,
    };
  }
}
