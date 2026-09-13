import { Router } from 'express';
import { issueOtp, checkOtp } from '../otp.js';
import { claimUsername, verifyCreatorPhone, findByPhone, getCreatorById, sweepExpiredReservations } from '../domain/onboarding.js';
import { createPendingToken, createSessionToken, setPendingCookie, setSessionCookie, clearSessionCookie, requireSameOrigin } from '../security/session.js';
import { selfCreator } from '../serialize.js';
import { maskPhone, normalizePhone } from '../security/phone.js';

const router = Router();

// Per-route buckets: claiming, code delivery and code verification each get
// their own budget (keyed per phone where applicable).
const limiter = (name) => (req, res, next) => req.app.get('limiters')[name](req, res, next);

/**
 * Step 1 of onboarding: claim a username and link a phone. Creates a draft
 * creator with a reservation TTL and sends the OTP. Nothing else is required
 * to have a link — no email, no password.
 */
router.post('/claim', limiter('claim'), async (req, res) => {
  if (requireSameOrigin(req, res) === null) return;
  const { username, displayName, phone } = req.body ?? {};

  const result = await claimUsername({ username, displayName, phone });
  if (result.error === 'username_taken') return res.status(409).json({ error: 'That username is taken.' });
  if (result.error === 'phone_already_claimed') {
    return res.status(409).json({ error: 'That phone already has a page. Sign in instead.' });
  }
  if (result.error === 'invalid_phone') return res.status(400).json({ error: 'Enter a valid phone number.' });
  if (result.error === 'invalid_username') return res.status(400).json({ error: result.detail });
  if (result.error === 'invalid_display_name') return res.status(400).json({ error: result.detail });

  try {
    await issueOtp({ creatorId: result.creator.id, phone: result.phone, purpose: 'claim' });
  } catch (err) {
    // No code was deliverable — do not leave a squat reservation behind.
    const { db } = await import('../db.js');
    db.prepare('DELETE FROM otp_challenges WHERE creator_id = ?').run(result.creator.id);
    db.prepare('DELETE FROM creators WHERE id = ?').run(result.creator.id);
    console.error('[buymepap] otp delivery failed:', err.message);
    return res.status(502).json({ error: 'Could not send the verification code. Try again in a moment.' });
  }

  const pending = await createPendingToken(result.creator.id, result.phone);
  setPendingCookie(res, pending);
  res.status(201).json({
    creator: { username: result.creator.username, displayName: result.creator.display_name },
    phoneMasked: maskPhone(result.phone),
    reservedUntil: result.creator.username_reserved_until,
  });
});

/** Sign-in OTP for an existing verified creator. Never reveals whether a phone is registered. */
router.post('/otp/request', limiter('otpRequest'), async (req, res) => {
  if (requireSameOrigin(req, res) === null) return;
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'Enter a valid phone number.' });

  const creator = findByPhone(phone);
  if (creator && creator.phone_verified_at && creator.status !== 'suspended') {
    await issueOtp({ creatorId: creator.id, phone, purpose: 'signin' });
    const pending = await createPendingToken(creator.id, phone);
    setPendingCookie(res, pending);
  }
  res.json({ sent: true });
});

/** Step 2 of onboarding (and sign-in): prove phone ownership with the code. */
router.post('/otp/verify', limiter('otpVerify'), async (req, res) => {
  if (requireSameOrigin(req, res) === null) return;
  if (!req.session || req.session.scope !== 'pending') {
    return res.status(401).json({ error: 'Start again from your link.' });
  }
  const code = req.body?.code;
  if (typeof code !== 'string' || !/^\d{4,8}$/.test(code)) {
    return res.status(400).json({ error: 'Enter the code we sent you.' });
  }

  const result = checkOtp({ phone: req.session.phone, code });
  if (!result.ok) {
    const status = result.reason === 'too_many_attempts' ? 429 : 400;
    const message =
      result.reason === 'too_many_attempts'
        ? 'Too many wrong codes. Request a new one.'
        : result.reason === 'expired'
          ? 'That code expired. Request a new one.'
          : 'That code is not right. Check the SMS and try again.';
    return res.status(status).json({ error: message, reason: result.reason });
  }

  const creator = getCreatorById(result.creatorId);
  if (!creator) return res.status(410).json({ error: 'This page reservation expired. Claim your link again.' });

  if (result.purpose === 'claim') {
    const verified = verifyCreatorPhone(creator.id, req.session.phone);
    if (verified.error) {
      return res.status(410).json({ error: 'This page can no longer be verified. Claim your link again.' });
    }
  }

  const session = await createSessionToken(getCreatorById(creator.id));
  setSessionCookie(res, session);
  res.json({ creator: selfCreator(getCreatorById(creator.id)) });
});

router.get('/session', (req, res) => {
  if (!req.session || req.session.scope !== 'creator') return res.json({ creator: null });
  const creator = getCreatorById(Number(req.session.sub));
  res.json({ creator: creator ? selfCreator(creator) : null });
});

router.post('/logout', (req, res) => {
  if (requireSameOrigin(req, res) === null) return;
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Housekeeping entry point used by ops and tests; harmless to call anytime.
router.post('/maintenance/sweep', (req, res) => {
  if (requireSameOrigin(req, res) === null) return;
  res.json({ released: sweepExpiredReservations() });
});

export default router;
