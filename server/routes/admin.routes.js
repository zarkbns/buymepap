import { Router } from 'express';
import crypto from 'node:crypto';
import config from '../config.js';
import { createPaymentProvider } from '../payments/index.js';
import { applyProviderConfirmation } from '../domain/payments.js';
import { reconcileWithdrawal, getWithdrawal } from '../domain/withdrawals.js';
import { sweepExpiredReservations } from '../domain/onboarding.js';

const router = Router();
const provider = createPaymentProvider();

/** Ops endpoints, authenticated by a shared admin bearer token (timing-safe). */
function adminRequired(req, res, next) {
  if (!config.adminToken) return res.status(404).json({ error: 'Not found.' });
  const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(config.adminToken);
  const b = Buffer.from(typeof provided === 'string' ? provided : '');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Admin token required.' });
  }
  next();
}

router.use(adminRequired);

/** Re-checks a payment against provider state, independent of webhooks. */
router.post('/payments/:reference/reconcile', async (req, res) => {
  try {
    const verification = await provider.verifyPayment(req.params.reference);
    if (!verification) return res.status(404).json({ error: 'Reference unknown to the provider.' });
    const result = applyProviderConfirmation(req.params.reference, {
      status: verification.status,
      amountKobo: verification.amountKobo,
      currency: verification.currency,
      providerRef: verification.providerRef,
      via: 'admin_reconcile',
    });
    res.json({ outcome: result.outcome });
  } catch (err) {
    console.error('[buymepap] admin reconcile failed:', err instanceof ProviderError ? err.message : err?.name);
    res.status(502).json({ error: 'Provider is unreachable.' });
  }
});

/** Resolves a withdrawal stuck in `processing` by asking the provider. */
router.post('/withdrawals/:id/reconcile', async (req, res) => {
  const withdrawal = getWithdrawal(Number(req.params.id));
  if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found.' });
  const result = await reconcileWithdrawal(withdrawal, provider);
  res.json({ outcome: result.outcome });
});

router.post('/maintenance/sweep-reservations', (_req, res) => {
  res.json({ released: sweepExpiredReservations() });
});

export default router;
