import crypto from 'node:crypto';
import { db } from '../db.js';

/**
 * Durable provider-event log. `recordEvent` deduplicates on the provider's own
 * event id (falling back to the payload hash when it sends none), so a
 * replayed webhook, a gateway retry or two racing deliveries only ever get
 * processed once. Events whose last processing attempt failed are unlocked
 * here, so the next delivery retries them. The raw payload is never stored —
 * only its hash — because provider payloads can contain payer personal data.
 */
export function recordEvent({ provider, eventKey, eventType = '', reference = null, rawBody = null }) {
  const payloadSha256 = rawBody ? crypto.createHash('sha256').update(rawBody).digest('hex') : null;
  const key = eventKey ?? (payloadSha256 ? `sha:${payloadSha256}` : null);
  if (!key) return { inserted: false, retry: false, row: null };

  const select = () => db.prepare('SELECT * FROM provider_events WHERE provider = ? AND event_key = ?').get(provider, key);

  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO provider_events (provider, event_key, event_type, reference, payload_sha256)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(provider, key, eventType, reference, payloadSha256);
  if (inserted.changes === 1) return { inserted: true, retry: false, row: select() };

  const existing = select();
  if (existing && existing.status === 'failed') {
    db.prepare(`UPDATE provider_events SET status = 'received', error = NULL WHERE id = ?`).run(existing.id);
    return { inserted: false, retry: true, row: select() };
  }
  return { inserted: false, retry: false, row: existing };
}

export function markEventProcessed(eventId, error = null) {
  db.prepare(
    `UPDATE provider_events
     SET status = CASE WHEN ? IS NULL THEN 'processed' ELSE 'failed' END,
         error = ?, processed_at = datetime('now')
     WHERE id = ?`,
  ).run(error, error, eventId);
}
