import { db, transaction } from '../db.js';
import config from '../config.js';
import { assertKobo } from '../money.js';
import { availableBalanceKobo, postGuardedDebit, postLedgerEntry } from './ledger.js';
import { newWithdrawalReference } from '../security/phone.js';

export const WITHDRAWAL_STATUSES = ['requested', 'processing', 'paid', 'failed', 'reversed'];
const OPEN_STATUSES = ['requested', 'processing'];

export function getWithdrawal(id) {
  return db
    .prepare(
      `SELECT w.*, c.username AS creator_username FROM withdrawals w JOIN creators c ON c.id = w.creator_id WHERE w.id = ?`,
    )
    .get(id);
}

export function getWithdrawalByReference(reference) {
  return db
    .prepare(
      `SELECT w.*, c.username AS creator_username FROM withdrawals w JOIN creators c ON c.id = w.creator_id WHERE w.reference = ?`,
    )
    .get(reference);
}

export function listWithdrawals(creatorId, limit = 20) {
  return db.prepare('SELECT * FROM withdrawals WHERE creator_id = ? ORDER BY requested_at DESC, id DESC LIMIT ?').all(creatorId, limit);
}

export function openWithdrawalCount(creatorId) {
  return db
    .prepare(`SELECT COUNT(*) AS n FROM withdrawals WHERE creator_id = ? AND status IN ('requested','processing')`)
    .get(creatorId).n;
}

/**
 * Requests a withdrawal and reserves the funds atomically. The debit ledger
 * row is inserted under a balance guard inside one IMMEDIATE transaction, so:
 *  - the balance comes from the ledger, never from client-provided numbers,
 *  - two concurrent requests cannot both spend the same kobo,
 *  - a failed insert rolls the whole request back.
 */
export function requestWithdrawal({ creator, amountKobo }) {
  assertKobo(amountKobo, 'amountKobo');
  if (amountKobo < config.minWithdrawalKobo) return { error: 'withdrawal_below_minimum', minKobo: config.minWithdrawalKobo };
  if (amountKobo > config.maxWithdrawalKobo) return { error: 'withdrawal_above_maximum', maxKobo: config.maxWithdrawalKobo };
  if (!creator.payments_active) return { error: 'payments_not_active' };
  if (creator.payout_status !== 'verified') return { error: 'payout_account_missing' };
  if (!creator.bank_code || !creator.bank_account_number) return { error: 'payout_account_missing' };
  if (openWithdrawalCount(creator.id) >= config.maxOpenWithdrawals) return { error: 'too_many_open_withdrawals' };

  return transaction(() => {
    const available = availableBalanceKobo(creator.id);
    if (available < amountKobo) return { error: 'insufficient_balance', availableKobo: available };

    const reference = newWithdrawalReference();
    const result = db
      .prepare(
        `INSERT INTO withdrawals
           (creator_id, amount_kobo, fee_kobo, currency, reference, provider, bank_code, bank_name,
            account_number, account_last4, account_name, narration)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        creator.id,
        amountKobo,
        config.withdrawalFeeKobo,
        creator.currency,
        reference,
        config.paymentsProvider,
        creator.bank_code,
        creator.bank_name,
        creator.bank_account_number,
        creator.bank_account_last4,
        creator.payout_account_name,
        `BuyMePap withdrawal for @${creator.username}`,
      );
    const withdrawalId = Number(result.lastInsertRowid);

    const posted = postGuardedDebit({
      creatorId: creator.id,
      kind: 'withdrawal_reserve',
      amountKobo: amountKobo + config.withdrawalFeeKobo,
      currency: creator.currency,
      withdrawalId,
      idempotencyKey: `withdrawal:${withdrawalId}:reserve`,
      description: `Withdrawal ${reference} reserved`,
    });
    if (!posted.posted) return { error: 'insufficient_balance', availableKobo: available };

    return { withdrawal: getWithdrawal(withdrawalId) };
  });
}

/** The reference sent to the provider must be unique per attempt. */
function providerReferenceFor(withdrawal, attempt) {
  return attempt > 1 ? `${withdrawal.reference}-a${attempt}` : withdrawal.reference;
}

/**
 * Sends a reserved withdrawal to the provider. Only a `requested` withdrawal
 * can start processing; the conditional UPDATE keeps a racing retry from
 * double-firing the payout. A definite provider failure returns the reserved
 * funds; an unknown outcome (timeout, network) deliberately leaves the
 * withdrawal in `processing` for reconciliation — reversing on ambiguity is
 * how double payouts happen.
 */
export async function sendWithdrawal(withdrawal, provider) {
  const started = db
    .prepare(
      `UPDATE withdrawals SET status = 'processing', attempts = attempts + 1, updated_at = datetime('now')
       WHERE id = ? AND status = 'requested'`,
    )
    .run(withdrawal.id);
  if (started.changes === 0) return { outcome: 'not_startable', withdrawal: getWithdrawal(withdrawal.id) };

  const attempt = db.prepare('SELECT attempts FROM withdrawals WHERE id = ?').get(withdrawal.id).attempts;

  try {
    const result = await provider.initiatePayout({
      reference: providerReferenceFor(withdrawal, attempt),
      amountKobo: withdrawal.amount_kobo,
      currency: withdrawal.currency,
      bankCode: withdrawal.bank_code,
      accountNumber: withdrawal.account_number,
      accountName: withdrawal.account_name,
      narration: withdrawal.narration,
    });
    db.prepare(
      `UPDATE withdrawals SET provider_ref = COALESCE(?, provider_ref),
         status = CASE WHEN ? = 'paid' THEN 'paid' WHEN ? = 'failed' THEN 'failed' ELSE 'processing' END,
         failure_reason = ?,
         settled_at = CASE WHEN ? = 'paid' THEN datetime('now') ELSE settled_at END,
         updated_at = datetime('now')
       WHERE id = ? AND status = 'processing'`,
    ).run(result.providerRef, result.status, result.status, result.failureReason ?? null, result.status, withdrawal.id);

    if (result.status === 'failed') {
      const reversal = reverseReservedFunds(withdrawal.id, 'failed');
      return { outcome: 'failed', withdrawal: reversal.withdrawal };
    }
    return { outcome: result.status === 'paid' ? 'paid' : 'processing', withdrawal: getWithdrawal(withdrawal.id) };
  } catch (err) {
    db.prepare(
      `UPDATE withdrawals SET failure_reason = 'provider_unreachable', updated_at = datetime('now')
       WHERE id = ? AND status = 'processing'`,
    ).run(withdrawal.id);
    return { outcome: 'provider_unreachable', error: err, withdrawal: getWithdrawal(withdrawal.id) };
  }
}

/**
 * Returns reserved funds to the creator's balance exactly once, setting the
 * terminal status to `failed` (provider refused) or `reversed` (bank pulled
 * the transfer back). The ledger idempotency key makes the credit one-shot
 * even if both a webhook and a reconciliation call arrive.
 */
export function reverseReservedFunds(withdrawalId, terminalStatus) {
  return transaction(() => {
    const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(withdrawalId);
    if (!withdrawal) return { outcome: 'not_found' };
    if (withdrawal.status === terminalStatus) return { outcome: 'already', withdrawal };

    const updated = db
      .prepare(
        `UPDATE withdrawals SET status = ?, updated_at = datetime('now')
         WHERE id = ? AND status IN ('requested','processing','paid')`,
      )
      .run(terminalStatus, withdrawalId);
    if (updated.changes === 0) return { outcome: 'not_reversible', withdrawal: getWithdrawal(withdrawalId) };

    postLedgerEntry({
      creatorId: withdrawal.creator_id,
      kind: 'withdrawal_reversal',
      direction: 'credit',
      amountKobo: withdrawal.amount_kobo + withdrawal.fee_kobo,
      currency: withdrawal.currency,
      withdrawalId,
      idempotencyKey: `withdrawal:${withdrawalId}:reversal`,
      description: `Withdrawal ${withdrawal.reference} returned to balance (${terminalStatus})`,
    });
    return { outcome: terminalStatus, withdrawal: db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(withdrawalId) };
  });
}

export function markWithdrawalPaid(withdrawalId, providerRef) {
  const updated = db
    .prepare(
      `UPDATE withdrawals SET status = 'paid', provider_ref = COALESCE(provider_ref, ?), settled_at = datetime('now'),
         failure_reason = NULL, updated_at = datetime('now')
       WHERE id = ? AND status IN ('requested','processing')`,
    )
    .run(providerRef, withdrawalId);
  return updated.changes === 1 ? getWithdrawal(withdrawalId) : null;
}

/** Webhook/reconciliation transition for bank reversals (funds return to the creator). */
export function markWithdrawalReversed(withdrawalId, providerRef) {
  db.prepare('UPDATE withdrawals SET provider_ref = COALESCE(provider_ref, ?) WHERE id = ?').run(providerRef, withdrawalId);
  return reverseReservedFunds(withdrawalId, 'reversed');
}

/**
 * Asks the provider for the current payout state and applies it. Safe to run
 * repeatedly; this is the recovery path for the `processing` limbo left by
 * provider timeouts.
 */
export async function reconcileWithdrawal(withdrawal, provider) {
  if (!withdrawal.provider_ref) return { outcome: 'no_provider_ref' };
  let state;
  try {
    state = await provider.fetchPayout(withdrawal.provider_ref);
  } catch {
    return { outcome: 'provider_unreachable' };
  }
  if (state.status === 'paid') {
    const updated = markWithdrawalPaid(withdrawal.id, withdrawal.provider_ref);
    return { outcome: updated ? 'paid' : 'unchanged', withdrawal: updated ?? getWithdrawal(withdrawal.id) };
  }
  if (state.status === 'failed') {
    const reversal = reverseReservedFunds(withdrawal.id, 'failed');
    return { outcome: reversal.outcome === 'failed' ? 'reversed' : 'unchanged', withdrawal: reversal.withdrawal };
  }
  if (state.status === 'reversed') {
    const result = markWithdrawalReversed(withdrawal.id, withdrawal.provider_ref);
    return { outcome: result.outcome, withdrawal: result.withdrawal ?? getWithdrawal(withdrawal.id) };
  }
  return { outcome: 'still_processing', withdrawal: getWithdrawal(withdrawal.id) };
}
