import config from '../config.js';
import { MockPaymentProvider } from './mock.js';
import { FlutterwaveProvider } from './flutterwave.js';

/**
 * The only surface the financial domain knows about payment providers:
 *
 *   name: string
 *   initializePayment({ reference, amountKobo, currency, customerName,
 *                       customerEmail, redirectUrl, metadata })
 *       -> { checkoutUrl, providerRef | null }
 *   verifyPayment(reference)
 *       -> { status: 'success'|'failed'|'pending', providerRef, amountKobo,
 *            currency, paidAt } | null   (null = reference unknown to provider)
 *   verifyWebhook(rawBody, headers)
 *       -> { ok: boolean, event | null }   (event: { key, type, reference,
 *            providerRef, status, amountKobo, currency })
 *   listBanks()
 *       -> [{ code, name }]
 *   resolvePayoutAccount({ bankCode, accountNumber })
 *       -> { accountName, bankName | null, beneficiaryRef | null }
 *   initiatePayout({ reference, amountKobo, currency, bankCode, accountNumber,
 *                    accountName, narration })
 *       -> { providerRef, status: 'processing'|'paid'|'failed', failureReason }
 *   fetchPayout(providerRef)
 *       -> { status: 'processing'|'paid'|'failed'|'reversed', failureReason }
 *
 * Adapters must never log or embed their credentials, and route handlers must
 * never forward provider error bodies to clients.
 */

export function createPaymentProvider(cfg = config, { fetchImpl } = {}) {
  if (cfg.paymentsProvider === 'flutterwave') {
    return new FlutterwaveProvider(cfg.flutterwave, { fetchImpl });
  }
  return new MockPaymentProvider();
}

/** Thrown by adapters; message is safe to log but never to echo verbatim. */
export class ProviderError extends Error {
  constructor(message, { status, kind } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.kind = kind ?? 'provider_error';
  }
}
