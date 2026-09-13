import { Router } from 'express';
import db from '../db.js';
import config from '../config.js';
import { getCreatorByUsername, activationStates } from '../domain/onboarding.js';
import { createPendingPayment, markPaymentInitialized, markPaymentFailed } from '../domain/payments.js';
import { publicCreator, publicPayment } from '../serialize.js';
import { validateSupportInput, validateEmail } from '../validators.js';
import { newPaymentReference } from '../security/phone.js';
import { ProviderError, createPaymentProvider } from '../payments/index.js';
import { requireSameOrigin } from '../security/session.js';

const router = Router();
const provider = createPaymentProvider();

function publicStats(creatorId) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(cups), 0) AS cups, COUNT(*) AS count, COALESCE(SUM(amount_kobo), 0) AS gross_kobo
       FROM payments WHERE creator_id = ? AND status = 'success'`,
    )
    .get(creatorId);
}

function listPaidSupporters(creatorId, limit = 20) {
  return db
    .prepare(
      `SELECT * FROM payments WHERE creator_id = ? AND status = 'success'
       ORDER BY credited_at DESC, id DESC LIMIT ?`,
    )
    .all(creatorId, limit);
}

/** Draft pages are not public — the product makes the page available only after phone verification. */
function visibleCreator(username) {
  const creator = getCreatorByUsername(username);
  if (!creator) return null;
  if (creator.status === 'draft' || creator.status === 'suspended') return null;
  return creator;
}

router.get('/:username', (req, res) => {
  const creator = visibleCreator(req.params.username);
  if (!creator) return res.status(404).json({ error: 'Creator not found.' });
  const stats = publicStats(creator.id);
  res.json({
    creator: publicCreator(creator),
    supporters: listPaidSupporters(creator.id, 20).map(publicPayment),
    stats: {
      cups: Number(stats.cups),
      supportCount: Number(stats.count),
      grossKobo: Number(stats.gross_kobo),
    },
    canAcceptPayments: Boolean(creator.payments_active),
  });
});

/**
 * Creates a pending payment and hands back the provider checkout URL. The
 * pending row exists before the provider call so a webhook racing the
 * redirect always finds its payment. The provider response is never echoed to
 * the client on failure — only a generic 502.
 */
router.post('/:username/supports', (req, res, next) => req.app.get('limiters').paymentInit(req, res, next), async (req, res) => {
  if (requireSameOrigin(req, res) === null) return;

  const creator = visibleCreator(req.params.username);
  if (!creator) return res.status(404).json({ error: 'Creator not found.' });
  if (!creator.payments_active) {
    return res.status(409).json({ error: 'This page is not accepting payments yet.' });
  }

  const { cups, name, message = '', isAnonymous = false, email = '' } = req.body ?? {};
  const invalid = validateSupportInput({ cups, name, message, isAnonymous });
  if (invalid) return res.status(400).json({ error: invalid });
  const emailError = validateEmail(email);
  if (emailError) return res.status(400).json({ error: emailError });

  const amountKobo = creator.cup_price_kobo * cups;
  if (amountKobo < config.minSupportKobo) return res.status(400).json({ error: 'That amount is too small.' });
  if (amountKobo > config.maxSupportKobo) return res.status(400).json({ error: 'That amount is too large.' });

  const reference = newPaymentReference();
  const paymentId = createPendingPayment({
    creatorId: creator.id,
    cups,
    supporterName: name.trim(),
    message: message.trim(),
    isAnonymous,
    supporterEmail: email ? String(email).trim().toLowerCase() : null,
    amountKobo,
    currency: creator.currency,
    reference,
    provider: provider.name,
    feeBasisPoints: config.platformFeeBasisPoints,
  });

  try {
    const init = await provider.initializePayment({
      reference,
      amountKobo,
      currency: creator.currency,
      customerName: name.trim(),
      customerEmail: email ? String(email).trim().toLowerCase() : `supporter+${reference}@buymepap.app`,
      redirectUrl: `${config.appUrl}/${creator.username}?reference=${encodeURIComponent(reference)}`,
      metadata: { creator: creator.username, cups, paymentId },
    });
    markPaymentInitialized(reference, init.providerRef);
    res.status(201).json({ checkoutUrl: init.checkoutUrl, reference, amountKobo, currency: creator.currency });
  } catch (err) {
    markPaymentFailed(reference, null);
    console.error('[buymepap] payment init failed:', err instanceof ProviderError ? err.message : err?.name);
    res.status(502).json({ error: 'Payment provider is unavailable. Try again.' });
  }
});

export default router;
