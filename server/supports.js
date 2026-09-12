import db from './db.js';

export function getSupportByReference(reference) {
  return db
    .prepare(
      `SELECT s.*, c.username AS creator_username
       FROM supports s JOIN creators c ON c.id = s.creator_id
       WHERE s.reference = ?`
    )
    .get(reference);
}

export function createPendingSupport({ creatorId, supporterName, message, cups, amountKobo, currency, reference, isAnonymous }) {
  db.prepare(
    `INSERT INTO supports
       (creator_id, supporter_name, message, cups, amount, currency, reference, is_anonymous)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(creatorId, supporterName, message, cups, amountKobo, currency, reference, isAnonymous ? 1 : 0);
  return getSupportByReference(reference);
}

export function markSupportFailed(reference) {
  db.prepare(`UPDATE supports SET status = 'failed' WHERE reference = ? AND status = 'pending'`).run(reference);
}

// Idempotent: only a pending support can transition to success, so webhook
// retries and duplicate confirmations are safe.
export function fulfillSupport(reference) {
  const support = getSupportByReference(reference);
  if (!support || support.status !== 'pending') return support ?? null;
  db.prepare(`UPDATE supports SET status = 'success', paid_at = datetime('now') WHERE id = ? AND status = 'pending'`).run(support.id);
  return getSupportByReference(reference);
}

export function listPaidSupports(creatorId, limit = 20) {
  return db
    .prepare(
      `SELECT s.*, c.username AS creator_username
       FROM supports s JOIN creators c ON c.id = s.creator_id
       WHERE s.creator_id = ? AND s.status = 'success'
       ORDER BY s.paid_at DESC, s.id DESC
       LIMIT ?`
    )
    .all(creatorId, limit);
}
