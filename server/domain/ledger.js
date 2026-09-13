import { db } from '../db.js';
import { assertKobo } from '../money.js';

/**
 * Append-only ledger. Balances are derived from these rows — there is no
 * separate mutable balance column to drift out of sync. Every entry carries a
 * UNIQUE idempotency key (`payment:{id}:net`, `withdrawal:{id}:reserve`,
 * `withdrawal:{id}:reversal`), so replaying an event or retrying a write can
 * never post money twice.
 */

export function postLedgerEntry(entry) {
  assertKobo(entry.amountKobo, 'amountKobo');
  if (entry.amountKobo === 0) return { posted: false, reason: 'zero_amount' };
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO ledger_entries
         (creator_id, kind, direction, amount_kobo, currency, payment_id, withdrawal_id, idempotency_key, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.creatorId,
      entry.kind,
      entry.direction,
      entry.amountKobo,
      entry.currency,
      entry.paymentId ?? null,
      entry.withdrawalId ?? null,
      entry.idempotencyKey,
      entry.description ?? '',
    );
  return { posted: result.changes === 1 };
}

/** Credits minus debits — the creator's spendable balance in kobo. */
export function availableBalanceKobo(creatorId) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_kobo ELSE -amount_kobo END), 0) AS balance
       FROM ledger_entries WHERE creator_id = ?`,
    )
    .get(creatorId);
  return Number(row.balance);
}

/**
 * Guarded debit: the ledger row is only inserted when the balance already
 * covers it. SQLite evaluates the WHERE under the write lock taken by the
 * surrounding IMMEDIATE transaction, so concurrent withdrawal requests cannot
 * both pass the check.
 */
export function postGuardedDebit(entry) {
  assertKobo(entry.amountKobo, 'amountKobo');
  const result = db
    .prepare(
      `INSERT INTO ledger_entries
         (creator_id, kind, direction, amount_kobo, currency, payment_id, withdrawal_id, idempotency_key, description)
       SELECT ?, ?, 'debit', ?, ?, ?, ?, ?, ?
       WHERE (
         SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_kobo ELSE -amount_kobo END), 0)
         FROM ledger_entries WHERE creator_id = ?
       ) >= ?`,
    )
    .run(
      entry.creatorId,
      entry.kind,
      entry.amountKobo,
      entry.currency,
      entry.paymentId ?? null,
      entry.withdrawalId ?? null,
      entry.idempotencyKey,
      entry.description ?? '',
      entry.creatorId,
      entry.amountKobo,
    );
  return { posted: result.changes === 1 };
}

export function lifetimeTotals(creatorId) {
  return db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN l.kind = 'payment_net' THEN l.amount_kobo ELSE 0 END), 0) AS lifetime_net_kobo,
         COUNT(DISTINCT l.payment_id) AS payment_count
       FROM ledger_entries l WHERE l.creator_id = ?`,
    )
    .get(creatorId);
}
