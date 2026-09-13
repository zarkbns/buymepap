import { db } from '../db.js';

/**
 * Local stand-in for a hosted checkout, used in development and tests. It
 * drives exactly the same financial state machine as the live provider: the
 * mock charge endpoint fulfils payments through the domain layer, never by
 * editing rows ad hoc. Every route backed by this adapter is 404 in production.
 */
export class MockPaymentProvider {
  get name() {
    return 'mock';
  }

  async initializePayment({ reference }) {
    return { checkoutUrl: `/mock-checkout?reference=${encodeURIComponent(reference)}`, providerRef: null };
  }

  async verifyPayment(reference) {
    const row = db.prepare('SELECT amount_kobo, currency, status, provider_ref FROM payments WHERE reference = ?').get(reference);
    if (!row) return null;
    return {
      status: row.status === 'success' ? 'success' : row.status === 'failed' ? 'failed' : 'pending',
      providerRef: row.provider_ref ?? `mock_${reference}`,
      amountKobo: row.amount_kobo,
      currency: row.currency,
      paidAt: null,
    };
  }

  verifyWebhook() {
    // Mock mode has no signature secret to trust; fulfillment goes through the
    // mock charge endpoint instead. Webhook routes are disabled with this
    // provider (503) the same way they are without a live secret.
    return { ok: false, event: null };
  }

  async resolvePayoutAccount({ bankCode, accountNumber }) {
    return { accountName: `MOCK HOLDER ${String(accountNumber).slice(-4)}`, bankName: bankCode, beneficiaryRef: null };
  }

  async initiatePayout({ reference }) {
    return { providerRef: `mocktr_${reference}`, status: 'processing', failureReason: null };
  }

  async fetchPayout(providerRef) {
    const row = db.prepare('SELECT status FROM withdrawals WHERE provider_ref = ?').get(providerRef);
    const status = row?.status ?? 'processing';
    return { status: status === 'paid' || status === 'failed' || status === 'reversed' ? status : 'processing', failureReason: null };
  }
}
