import { Router } from 'express';
import db from '../db.js';
import { isMock } from '../payments/paystack.js';
import { getSupportByReference, fulfillSupport, markSupportFailed } from '../supports.js';
import { supportLimiter } from '../limiters.js';

const router = Router();

// Local stand-in for Paystack's hosted checkout. Active only while no
// PAYSTACK_SECRET_KEY is configured; in live mode every route 404s so the
// mock flow can never move real money.
function mockOnly(req, res, next) {
  if (!isMock()) return res.status(404).json({ error: 'Not found.' });
  next();
}

router.get('/paystack/pending', mockOnly, (req, res) => {
  const reference = typeof req.query.reference === 'string' ? req.query.reference : '';
  const support = reference ? getSupportByReference(reference) : null;
  if (!support || support.status !== 'pending') {
    return res.status(404).json({ error: 'Nothing pending for this reference.' });
  }
  const creator = db.prepare('SELECT * FROM creators WHERE id = ?').get(support.creator_id);
  res.json({
    reference: support.reference,
    cups: support.cups,
    amountKobo: support.amount,
    currency: support.currency,
    supporterName: support.supporter_name,
    creator: {
      username: creator.username,
      displayName: creator.display_name,
      avatarEmoji: creator.avatar_emoji,
    },
  });
});

router.post('/paystack/charge', mockOnly, supportLimiter, (req, res) => {
  const { reference, outcome } = req.body ?? {};
  if (typeof reference !== 'string' || (outcome !== 'success' && outcome !== 'failed')) {
    return res.status(400).json({ error: 'reference and outcome (success|failed) are required.' });
  }
  const support = getSupportByReference(reference);
  if (!support) return res.status(404).json({ error: 'Support not found.' });

  if (outcome === 'success') fulfillSupport(reference);
  else markSupportFailed(reference);

  const fresh = getSupportByReference(reference);
  res.json({ status: fresh.status, creatorUsername: fresh.creator_username, reference });
});

export default router;
