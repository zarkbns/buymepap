import db, { config } from './db.js';
import { generateOtpCode, hashOtpCode, otpCodesMatch } from './security/phone.js';
import { sendOtpSms } from './sms/index.js';

function activeChallenges(phone) {
  return db
    .prepare(
      `SELECT * FROM otp_challenges
       WHERE phone_e164 = ? AND consumed_at IS NULL AND expires_at > datetime('now')
       ORDER BY id DESC`,
    )
    .all(phone);
}

/**
 * Creates an OTP challenge and hands the code to the SMS adapter. The code is
 * never stored in plaintext and never returned to a client — the only place it
 * exists outside the SMS gateway is the HMAC hash in the database.
 */
export async function issueOtp({ creatorId, phone, purpose }) {
  const code = generateOtpCode();
  const result = db
    .prepare(
      `INSERT INTO otp_challenges (creator_id, phone_e164, purpose, code_hash, max_attempts, expires_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', ?))`,
    )
    .run(creatorId, phone, purpose, hashOtpCode(phone, code), config.otpMaxAttempts, `+${config.otpTtlSeconds} seconds`);
  await sendOtpSms(phone, code);
  return { challengeId: Number(result.lastInsertRowid), expiresInSeconds: config.otpTtlSeconds };
}

/**
 * Single-use verification with an attempt cap. Returns one of:
 *  - { ok: true, creatorId }
 *  - { ok: false, reason: 'invalid' | 'expired' | 'too_many_attempts' }
 * The matching challenge is consumed atomically (conditional UPDATE), so two
 * concurrent requests can never both consume the same code.
 */
export function checkOtp({ phone, code }) {
  if (typeof code !== 'string' || !/^\d{4,8}$/.test(code)) return { ok: false, reason: 'invalid' };
  const challenges = activeChallenges(phone);
  if (challenges.length === 0) return { ok: false, reason: 'expired' };

  const matching = challenges.find((c) => otpCodesMatch(phone, code, c.code_hash));
  if (!matching) {
    const bump = db
      .prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ? AND consumed_at IS NULL')
      .run(challenges[0].id);
    if (bump.changes === 0) return { ok: false, reason: 'expired' };
    const fresh = db.prepare('SELECT attempts, max_attempts FROM otp_challenges WHERE id = ?').get(challenges[0].id);
    if (fresh.attempts >= fresh.max_attempts) {
      db.prepare('UPDATE otp_challenges SET consumed_at = datetime(\'now\') WHERE id = ?').run(challenges[0].id);
      return { ok: false, reason: 'too_many_attempts' };
    }
    return { ok: false, reason: 'invalid' };
  }

  const consumed = db
    .prepare(
      `UPDATE otp_challenges SET consumed_at = datetime('now')
       WHERE id = ? AND consumed_at IS NULL AND attempts <= max_attempts`,
    )
    .run(matching.id);
  if (consumed.changes === 0) return { ok: false, reason: 'invalid' };
  return { ok: true, creatorId: matching.creator_id, purpose: matching.purpose };
}

export { activeChallenges };
