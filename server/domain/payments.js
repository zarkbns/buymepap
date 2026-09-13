import { db, transaction } from '../db.js';
import { assertKobo, splitAmount } from '../money.js';
import { postLedgerEntry } from './ledger.js';

export const PAYMENT_STATUSES = ['pending', 'success', 'failed'];

export function getPaymentByReference(reference) {
  return db
    .prepare(
      `SELECT p.*, c.username AS creator_username, c.currency AS creator_currency
       FROM payments p JOIN creators c ON c.id = p.creator_id
       WHERE p.reference = ?`,
    )
    .get(reference);
}

/**
 * Creates the pending payment row with the fee snapshot taken from the
 * configuration at creation time. Historical rows are never re-derived from
 * later config changes; the ledger records these exact amounts.
 */
export function createPendingPayment({ creatorId, cups, supporterName, message, isAnonymous, supporterEmail, amountKobo, currency, reference, provider, feeBasisPoints }) {
  assertKobo(amountKobo, 'amountKobo');
  const { fee, net } = splitAmount(amountKobo, feeBasisPoints);
  const result = db
    .prepare(
      `INSERT INTO payments
         (creator_id, supporter_name, message, cups, amount_kobo, fee_kobo, net_kobo, fee_bps,
          currency, reference, provider, supporter_email, is_anonymous)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      creatorId,
      supporterName,
      message,
      cups,
      amountKobo,
      fee,
      net,
      feeBasisPoints,
      currency,
      reference,
      provider,
      supporterEmail ?? null,
      isAnonymous ? 1 : 0,
    );
  return Number(result.lastInsertRowid);
}

export function markPaymentInitialized(reference, providerRef) {
  db.prepare('UPDATE payments SET provider_ref = COALESCE(provider_ref, ?), updated_at = datetime(\'now\') WHERE reference = ?').run(
    providerRef ?? null,
    reference,
  );
}

export function markPaymentFailed(reference, providerRef) {
  db.prepare(
    `UPDATE payments SET status = 'failed', provider_ref = COALESCE(provider_ref, ?), updated_at = datetime('now')
     WHERE reference = ? AND status = 'pending'`,
  ).run(providerRef ?? null, reference);
}

/**
 * Fulfils a payment exactly once. Guarded by three independent locks:
 *  1. the pending -> success conditional UPDATE (only one writer wins),
 *  2. the ledger idempotency key (`payment:{id}:net`),
 *  3. provider_events dedupe upstream of this call.
 *
 * The provider-reported amount is checked against the stored amount before
 * any credit is posted; a mismatch marks the row `amount_mismatch` and leaves
 * the ledger untouched rather than crediting a wrong figure.
 */
// Caller must hold a transaction (applyProviderConfirmation provides one).
function settlePayment(reference, { providerRef = null } = {}) {
  {
    const payment = db.prepare('SELECT * FROM payments WHERE reference = ?').get(reference);
    if (!payment) return { outcome: 'not_found' };
    if (payment.status === 'success') return { outcome: 'already_settled', payment };
    if (payment.status !== 'pending') return { outcome: 'not_pending', payment };

    const updated = db
      .prepare(
        `UPDATE payments
         SET status = 'success', provider_ref = COALESCE(provider_ref, ?), credited_at = datetime('now'),
             verified_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ? AND status = 'pending'`,
      )
      .run(providerRef, payment.id);
    if (updated.changes === 0) {
      const fresh = db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id);
      return { outcome: 'already_settled', payment: fresh };
    }
    const posted = postLedgerEntry({
      creatorId: payment.creator_id,
      kind: 'payment_net',
      direction: 'credit',
      amountKobo: payment.net_kobo,
      currency: payment.currency,
      paymentId: payment.id,
      idempotencyKey: `payment:${payment.id}:net`,
      description: `Support from ${payment.supporter_name}`,
    });
    if (!posted.posted) {
      throw new Error(`ledger entry for payment ${payment.id} already exists but status was pending`);
    }
    return { outcome: 'settled', payment: db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id) };
  }
}

/**
 * Single entry point for "the provider says something about this payment".
 * Used by webhooks, the status endpoint's server-side verification and admin
 * reconciliation, so every path enforces the same amount/currency checks and
 * the same once-only credit. Never trusts the browser redirect alone.
 */
export function applyProviderConfirmation(reference, confirmation) {
  return transaction(() => {
    const payment = db.prepare('SELECT * FROM payments WHERE reference = ?').get(reference);
    if (!payment) return { outcome: 'not_found' };

    if (confirmation.status === 'success') {
      const amountOk = confirmation.amountKobo === payment.amount_kobo;
      const currencyOk = !confirmation.currency || confirmation.currency === payment.currency;
      if (!amountOk || !currencyOk) {
        db.prepare(
          `UPDATE payments SET reconcile_status = 'amount_mismatch', updated_at = datetime('now') WHERE id = ?`,
        ).run(payment.id);
        return { outcome: 'amount_mismatch', payment };
      }
      return settlePayment(reference, { providerRef: confirmation.providerRef, via: confirmation.via });
    }

    if (confirmation.status === 'failed') {
      markPaymentFailed(reference, confirmation.providerRef);
      return { outcome: 'failed', payment: db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id) };
    }

    return { outcome: 'unchanged', payment };
  });
}

export function listRecentPaidPayments(creatorId, limit = 10) {
  return db
    .prepare(
      `SELECT * FROM payments WHERE creator_id = ? AND status = 'success'
       ORDER BY credited_at DESC, id DESC LIMIT ?`,
    )
    .all(creatorId, limit);
}

export function publicPaymentStats(creatorId) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_kobo), 0) AS gross_kobo, COALESCE(SUM(fee_kobo), 0) AS fee_kobo,
              COALESCE(SUM(net_kobo), 0) AS net_kobo, COALESCE(SUM(cups), 0) AS cups, COUNT(*) AS count
       FROM payments WHERE creator_id = ? AND status = 'success'`,
    )
    .get(creatorId);
}

export function monthlyPaidStats(creatorId) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_kobo), 0) AS gross_kobo, COUNT(*) AS count
       FROM payments WHERE creator_id = ? AND status = 'success' AND credited_at >= datetime('now', '-30 days')`,
    )
    .get(creatorId);
}
