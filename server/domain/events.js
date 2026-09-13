import crypto from 'node:crypto';
import { db } from '../db.js';

/**
 * Durable provider-event log. `recordEvent` deduplicates on the provider's own
 * event id (falling back to the payload hash when it sends none), so a
 * replayed webhook, a gateway retry or two racing deliveries only ever get
 * processed once. The raw payload is never stored — only its hash — because
 * provider payloads can contain payer personal data.
 */
export function recordEvent({ provider, eventKey, eventType = '', reference = null, rawBody = null }) {
  const payloadSha256 = rawBody ? crypto.createHash('sha256').update(rawBody).digest('hex') : null;
  const key = eventKey ?? (payloadSha256 ? `sha:${payloadSha256}` : null);
  if (!key) return { inserted: false, row: null };

  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO provider_events (provider, event_key, event_type, reference, payload_sha256)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(provider, key, eventType, reference, payloadSha256);
  if (inserted.changes === 0) {
    return { inserted: false, row: db.prepare('SELECT * FROM provider_events WHERE provider = ? AND event_key = ?').get(provider, key) };
  }
  return { inserted: true, row: db.prepare('SELECT * FROM provider_events WHERE provider = ? AND event_key = ?').get(provider, key) };
}

export function markEventProcessed(eventId, error = null) {
  db.prepare(
    `UPDATE provider_events
     SET status = CASE WHEN ? IS NULL THEN 'processed' ELSE 'failed' END,
         error = ?, processed_at = datetime('now')
     WHERE id = ?`,
  ).run(error, error, eventId);
}
