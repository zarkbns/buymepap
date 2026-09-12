import { Router } from 'express';
import db from '../db.js';
import config from '../config.js';
import { validateSupportInput, validateEmail, MAX_AMOUNT_KOBO } from '../validators.js';
import { publicCreator, publicSupport } from '../serialize.js';
import { createPendingSupport, listPaidSupports } from '../supports.js';
import { initializeTransaction, newReference } from '../payments/paystack.js';
import { supportLimiter } from '../limiters.js';

const router = Router();

function findCreator(username) {
  return db.prepare('SELECT * FROM creators WHERE username = ?').get(String(username).toLowerCase());
}

router.get('/:username', (req, res) => {
  const creator = findCreator(req.params.username);
  if (!creator) return res.status(404).json({ error: 'Creator not found.' });
  const supporters = listPaidSupports(creator.id, 20).map(publicSupport);
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(cups), 0) AS cups, COUNT(*) AS support_count, COALESCE(SUM(amount), 0) AS earned_kobo
       FROM supports WHERE creator_id = ? AND status = 'success'`
    )
    .get(creator.id);
  res.json({
    creator: publicCreator(creator),
    supporters,
    stats: { cups: totals.cups, supportCount: totals.support_count, earnedKobo: totals.earned_kobo },
  });
});

router.post('/:username/supports', supportLimiter, async (req, res) => {
  const { cups, name, message = '', isAnonymous = false, email = '' } = req.body ?? {};
  const error = validateSupportInput({ cups, name, message, isAnonymous });
  if (error) return res.status(400).json({ error });
  if (email) {
    const emailError = validateEmail(email);
    if (emailError) return res.status(400).json({ error: emailError });
  }

  const creator = findCreator(req.params.username);
  if (!creator) return res.status(404).json({ error: 'Creator not found.' });

  const amountKobo = creator.cup_price * cups * 100;
  if (amountKobo > MAX_AMOUNT_KOBO) {
    return res.status(400).json({ error: 'Support amount is too large.' });
  }

  const reference = newReference();
  const payerEmail = email ? email.trim().toLowerCase() : `supporter+${reference}@buymepap.app`;
  const callbackUrl = `${config.appUrl}/${creator.username}?reference=${encodeURIComponent(reference)}`;

  try {
    const init = await initializeTransaction({
      email: payerEmail,
      amountKobo,
      reference,
      callbackUrl,
      metadata: { creatorUsername: creator.username, cups },
    });
    createPendingSupport({
      creatorId: creator.id,
      supporterName: name.trim(),
      message: message.trim(),
      cups,
      amountKobo,
      currency: creator.currency,
      reference,
      isAnonymous,
    });
    res.status(201).json({
      authorizationUrl: init.authorizationUrl,
      reference,
      amountKobo,
      currency: creator.currency,
    });
  } catch (err) {
    console.error('[buymepap] initialize failed:', err.message);
    res.status(502).json({ error: 'Payment provider is unavailable. Try again.' });
  }
});

export default router;
