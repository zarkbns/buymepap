import { Router } from 'express';
import { getPaymentByReference, applyProviderConfirmation } from '../domain/payments.js';
import { createPaymentProvider, ProviderError } from '../payments/index.js';
import { publicPayment } from '../serialize.js';

const router = Router();
const provider = createPaymentProvider();

/**
 * Authoritative payment status. A pending payment is checked against the
 * provider server-side — a browser redirect back from checkout never marks
 * anything as successful on its own.
 */
router.get('/:reference', async (req, res) => {
  const reference = req.params.reference;
  if (typeof reference !== 'string' || reference.length > 64 || !/^[a-z0-9_\-]+$/i.test(reference)) {
    return res.status(400).json({ error: 'Invalid reference.' });
  }
  let payment = getPaymentByReference(reference);
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });

  if (payment.status === 'pending') {
    try {
      const verification = await provider.verifyPayment(reference);
      if (verification) {
        const result = applyProviderConfirmation(reference, {
          status: verification.status,
          amountKobo: verification.amountKobo,
          currency: verification.currency,
          providerRef: verification.providerRef,
          via: 'server_verify',
        });
        if (result.outcome === 'amount_mismatch') {
          console.error('[buymepap] amount mismatch on', reference);
        }
        payment = getPaymentByReference(reference);
      }
    } catch (err) {
      // Verification is best-effort here; webhooks and reconciliation also settle.
      console.error('[buymepap] verify failed:', err instanceof ProviderError ? err.message : err?.name);
    }
  }

  res.json({
    status: payment.status,
    payment: payment.status === 'success' ? publicPayment(payment) : null,
    creatorUsername: payment.creator_username,
  });
});

export default router;
