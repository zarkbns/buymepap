import { Router } from 'express';
import db from '../db.js';
import { createPaymentProvider } from '../payments/index.js';
import { createKycProvider } from '../kyc/index.js';
import { setKycState, setPayoutAccount, activatePayments, activationStates, getCreatorById } from '../domain/onboarding.js';
import { updateProfile } from '../domain/profile.js';
import { availableBalanceKobo } from '../domain/ledger.js';
import { listWithdrawals, requestWithdrawal, sendWithdrawal, openWithdrawalCount } from '../domain/withdrawals.js';
import { publicPaymentStats, monthlyPaidStats, listRecentPaidPayments } from '../domain/payments.js';
import { creatorRequired, requireSameOrigin } from '../security/session.js';
import { selfCreator, dashboardPayment, selfWithdrawal } from '../serialize.js';
import { validateWithdrawalKobo, validateBankCode, validateAccountNumber } from '../validators.js';
import { ProviderError } from '../payments/index.js';

const router = Router();
const provider = createPaymentProvider();
const kyc = createKycProvider();

function pendingWithdrawalKobo(creatorId) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_kobo + fee_kobo), 0) AS pending
       FROM withdrawals WHERE creator_id = ? AND status IN ('requested','processing')`,
    )
    .get(creatorId);
  return Number(row.pending);
}

router.get('/me', creatorRequired, (req, res) => {
  res.json({
    creator: selfCreator(req.creator),
    activation: activationStates(req.creator),
    balance: { availableKobo: availableBalanceKobo(req.creator.id) },
  });
});

router.patch('/me', creatorRequired, (req, res) => {
  if (requireSameOrigin(req, res) === null) return;
  const result = updateProfile(req.creator, req.body ?? {});
  if (result.error) return res.status(400).json({ error: result.error });
  if (result.usernameTaken) return res.status(409).json({ error: 'That username is taken.' });
  res.json({ creator: selfCreator(result.creator) });
});

router.get('/me/dashboard', creatorRequired, (req, res) => {
  const id = req.creator.id;
  const totals = lifetimeTotals(id);
  const stats = publicPaymentStats(id);
  const month = monthlyPaidStats(id);
  res.json({
    creator: selfCreator(req.creator),
    activation: activationStates(req.creator),
    stats: {
      grossKobo: Number(stats.gross_kobo),
      feeKobo: Number(stats.fee_kobo),
      netKobo: Number(stats.net_kobo),
      cups: Number(stats.cups),
      supportCount: Number(stats.count),
      monthGrossKobo: Number(month.gross_kobo),
      paymentCount: Number(totals.payment_count),
    },
    balance: {
      availableKobo: availableBalanceKobo(id),
      pendingWithdrawalKobo: pendingWithdrawalKobo(id),
      openWithdrawals: openWithdrawalCount(id),
    },
    recent: listRecentPaidPayments(id, 10).map(dashboardPayment),
    withdrawals: listWithdrawals(id, 10).map(selfWithdrawal),
  });
});

function lifetimeTotals(creatorId) {
  return db
    .prepare(
      `SELECT COUNT(DISTINCT payment_id) AS payment_count
       FROM ledger_entries WHERE creator_id = ? AND kind = 'payment_net'`,
    )
    .get(creatorId);
}

/** Starts (or resumes) identity verification. Returns only browser-safe values. */
router.post('/me/kyc/session', creatorRequired, async (req, res) => {
  if (requireSameOrigin(req, res) === null) return;
  try {
    let creator = req.creator;
    if (!creator.kyc_ref) {
      const { applicantRef } = await kyc.createApplicant(creator);
      db.prepare(
        `UPDATE creators SET kyc_ref = ?, kyc_provider = ?,
           kyc_status = CASE WHEN kyc_status = 'none' THEN 'pending' ELSE kyc_status END,
           kyc_updated_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
      ).run(applicantRef, kyc.name, creator.id);
      creator = getCreatorById(creator.id);
    } else if (creator.kyc_status === 'none' || creator.kyc_status === 'expired') {
      setKycState(creator.id, { status: 'pending' });
      creator = getCreatorById(creator.id);
    }
    const session = await kyc.createSessionToken(creator);
    res.json({ ...session, kycStatus: creator.kyc_status });
  } catch (err) {
    if (err instanceof ProviderError) {
      console.error('[buymepap] kyc session failed:', err.message);
      return res.status(502).json({ error: 'Verification service is unavailable. Try again shortly.' });
    }
    throw err;
  }
});

/** Server-side check of the current review state — never trusts webhooks alone. */
router.post('/me/kyc/refresh', creatorRequired, async (req, res) => {
  if (requireSameOrigin(req, res) === null) return;
  if (!req.creator.kyc_ref) return res.status(409).json({ error: 'Start identity verification first.' });
  try {
    const decision = await kyc.fetchDecision(req.creator);
    if (decision.status !== 'pending') {
      setKycState(req.creator.id, { status: decision.status, reason: decision.reason ?? null });
    }
  } catch (err) {
    if (err instanceof ProviderError) {
      console.error('[buymepap] kyc refresh failed:', err.message);
      return res.status(502).json({ error: 'Verification service is unavailable. Try again shortly.' });
    }
    throw err;
  }
  const fresh = getCreatorById(req.creator.id);
  res.json({ kycStatus: fresh.kyc_status, activation: activationStates(fresh) });
});

/** Saves the payout account after the provider verifies the account name. */
router.put('/me/payout-account', creatorRequired, async (req, res) => {
  if (requireSameOrigin(req, res) === null) return;
  const { bankCode, accountNumber } = req.body ?? {};
  const validation = validateBankCode(bankCode) || validateAccountNumber(accountNumber);
  if (validation) return res.status(400).json({ error: validation });

  const result = await setPayoutAccount(req.creator, { bankCode, accountNumber }, provider);
  if (result.error === 'phone_not_verified') return res.status(403).json({ error: 'Verify your phone first.' });
  if (result.error === 'invalid_bank_code' || result.error === 'invalid_account_number') {
    return res.status(400).json({ error: 'Check the bank and account number.' });
  }
  if (result.error === 'account_verification_failed') {
    return res.status(400).json({ error: 'That bank account could not be verified. Check the details.' });
  }
  res.json({ creator: selfCreator(result.creator), activation: activationStates(result.creator) });
});

router.post('/me/activate', creatorRequired, (req, res) => {
  if (requireSameOrigin(req, res) === null) return;
  const result = activatePayments(req.creator);
  res.json({ activation: activationStates(result.creator) });
});

router.post('/me/withdrawals', creatorRequired, async (req, res) => {
  if (requireSameOrigin(req, res) === null) return;
  const amountKobo = req.body?.amountKobo;
  const invalid = validateWithdrawalKobo(amountKobo);
  if (invalid) return res.status(400).json({ error: invalid });

  const request = requestWithdrawal({ creator: req.creator, amountKobo });
  if (request.error) {
    if (request.error === 'insufficient_balance') {
      return res.status(400).json({ error: 'Not enough available balance.', availableKobo: request.availableKobo });
    }
    if (request.error === 'withdrawal_below_minimum') {
      return res.status(400).json({ error: 'Withdrawals start at ₦1,000.', minKobo: request.minKobo });
    }
    if (request.error === 'withdrawal_above_maximum') {
      return res.status(400).json({ error: 'That amount is above the single-withdrawal limit.', maxKobo: request.maxKobo });
    }
    if (request.error === 'payments_not_active') {
      return res.status(409).json({ error: 'Activate payments on your page first.' });
    }
    return res.status(409).json({ error: 'You have too many withdrawals in progress.' });
  }

  const sent = await sendWithdrawal(request.withdrawal, provider);
  if (sent.outcome === 'provider_unreachable') {
    console.error('[buymepap] payout send failed:', sent.error?.message);
    return res.status(202).json({
      withdrawal: selfWithdrawal(sent.withdrawal),
      message: 'The payout is queued with the bank. We will update it automatically.',
    });
  }
  res.status(201).json({ withdrawal: selfWithdrawal(sent.withdrawal) });
});

router.get('/me/withdrawals', creatorRequired, (req, res) => {
  res.json({ withdrawals: listWithdrawals(req.creator.id, 20).map(selfWithdrawal) });
});

export default router;
