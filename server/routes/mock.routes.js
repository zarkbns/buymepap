import { Router } from 'express';
import db from '../db.js';
import config from '../config.js';
import { applyProviderConfirmation } from '../domain/payments.js';
import { markWithdrawalPaid, markWithdrawalReversed, reverseReservedFunds, getWithdrawalByReference } from '../domain/withdrawals.js';
import { setKycState, getCreatorById } from '../domain/onboarding.js';
import { creatorRequired, requireSameOrigin } from '../security/session.js';
import { createPaymentProvider } from '../payments/index.js';

const router = Router();
const provider = createPaymentProvider();

/**
 * Local stand-ins for the provider console: completing a charge, deciding a
 * KYC review, settling a payout and reading the mock SMS outbox. Everything
 * here is unreachable in production (config.mockEndpointsEnabled is false
 * outside non-production) and drives the exact same domain transitions the
 * real provider paths use.
 */
function mockOnly(req, res, next) {
  if (!config.mockEndpointsEnabled || provider.name !== 'mock') {
    return res.status(404).json({ error: 'Not found.' });
  }
  next();
}

function refParam(req) {
  return typeof req.query.reference === 'string' ? req.query.reference : '';
}

router.get('/payments/pending', mockOnly, (req, res) => {
  const reference = refParam(req);
  const payment = reference ? db.prepare('SELECT * FROM payments WHERE reference = ?').get(reference) : null;
  if (!payment || payment.status !== 'pending') {
    return res.status(404).json({ error: 'Nothing pending for this reference.' });
  }
  const creator = db.prepare('SELECT * FROM creators WHERE id = ?').get(payment.creator_id);
  res.json({
    reference: payment.reference,
    cups: payment.cups,
    amountKobo: payment.amount_kobo,
    currency: payment.currency,
    supporterName: payment.supporter_name,
    creator: { username: creator.username, displayName: creator.display_name, avatarEmoji: creator.avatar_emoji },
  });
});

router.post('/payments/charge', mockOnly, (req, res) => {
  if (requireSameOrigin(req, res) === null) return;
  const { reference, outcome } = req.body ?? {};
  if (typeof reference !== 'string' || (outcome !== 'success' && outcome !== 'failed')) {
    return res.status(400).json({ error: 'reference and outcome (success|failed) are required.' });
  }
  const payment = db.prepare('SELECT * FROM payments WHERE reference = ?').get(reference);
  if (!payment) return res.status(404).json({ error: 'Support not found.' });

  // Behave like the provider: report the amount that was actually charged.
  const result = applyProviderConfirmation(reference, {
    status: outcome,
    amountKobo: outcome === 'success' ? payment.amount_kobo : undefined,
    providerRef: `mock_${reference}`,
    via: 'mock_charge',
  });
  const fresh = db.prepare('SELECT * FROM payments WHERE reference = ?').get(reference);
  res.json({ status: fresh.status, reference, outcome: result.outcome });
});

/** Simulates a Sumsub review decision for the signed-in creator. */
router.post('/kyc/decision', mockOnly, creatorRequired, (req, res) => {
  if (requireSameOrigin(req, res) === null) return;
  const { outcome } = req.body ?? {};
  if (outcome !== 'approved' && outcome !== 'rejected' && outcome !== 'pending') {
    return res.status(400).json({ error: 'outcome must be approved, rejected or pending.' });
  }
  const result = setKycState(req.creator.id, {
    status: outcome,
    reason: outcome === 'rejected' ? 'mock_rejection' : null,
  });
  res.json({ kycStatus: result.creator.kyc_status });
});

/** Simulates a Flutterwave transfer webhook for a mock payout. */
router.post('/payouts/complete', mockOnly, (req, res) => {
  if (requireSameOrigin(req, res) === null) return;
  const { reference, outcome } = req.body ?? {};
  if (typeof reference !== 'string' || !['paid', 'failed', 'reversed'].includes(outcome)) {
    return res.status(400).json({ error: 'reference and outcome (paid|failed|reversed) are required.' });
  }
  const withdrawal = getWithdrawalByReference(reference);
  if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found.' });

  if (outcome === 'paid') markWithdrawalPaid(withdrawal.id, withdrawal.provider_ref ?? `mocktr_${reference}`);
  else if (outcome === 'reversed') markWithdrawalReversed(withdrawal.id, withdrawal.provider_ref ?? `mocktr_${reference}`);
  else reverseReservedFunds(withdrawal.id, 'failed');

  const fresh = getWithdrawalByReference(reference);
  res.json({ status: fresh.status, reference });
});

/** Dev helper so a phone can complete the OTP flow without an SMS gateway. */
router.get('/sms/latest', mockOnly, (req, res) => {
  const phone = typeof req.query.phone === 'string' ? req.query.phone : '';
  if (!phone) return res.status(400).json({ error: 'phone is required.' });
  const row = db
    .prepare('SELECT body, created_at FROM sms_outbox WHERE phone_e164 = ? ORDER BY id DESC LIMIT 1')
    .get(phone);
  if (!row) return res.status(404).json({ error: 'No message recorded for that phone.' });
  res.json({ body: row.body, createdAt: row.created_at });
});

export default router;
