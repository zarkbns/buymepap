import { db, transaction, isUniqueViolation } from '../db.js';
import config from '../config.js';
import { validateUsername, validateDisplayName, normalizePhoneInput } from '../validators.js';
import { ProviderError, createPaymentProvider } from '../payments/index.js';

export const KYC_STATUSES = ['none', 'pending', 'approved', 'rejected', 'expired'];
export const PAYOUT_STATUSES = ['none', 'pending', 'verified', 'failed'];

function nowPlus(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

export function getCreatorByUsername(username) {
  return db.prepare('SELECT * FROM creators WHERE username = ?').get(String(username ?? '').toLowerCase());
}

export function getCreatorById(id) {
  return db.prepare('SELECT * FROM creators WHERE id = ?').get(id);
}

export function findByPhone(phone) {
  return db.prepare('SELECT * FROM creators WHERE phone_e164 = ?').get(phone);
}

/**
 * Claims a username for a phone number: creates the draft creator row and an
 * OTP challenge in one step. Collision safety comes from the UNIQUE index;
 * impersonation from the reserved-name list; abandoned pages from a
 * reservation TTL swept by sweepExpiredReservations.
 */
export async function claimUsername({ username, displayName, phone }) {
  const normalized = normalizePhoneInput(phone);
  if (!normalized) return { error: 'invalid_phone' };
  const usernameError = validateUsername(username);
  if (usernameError) return { error: 'invalid_username', detail: usernameError };
  const nameError = validateDisplayName(displayName);
  if (nameError) return { error: 'invalid_display_name', detail: nameError };

  const existingByPhone = findByPhone(normalized);
  if (existingByPhone) {
    // One phone, one creator. The owner signs in with an OTP instead of
    // silently claiming a second page.
    return { error: 'phone_already_claimed', creator: existingByPhone };
  }

  // Draft claims carry the phone only in otp_challenges (phone_e164 is set at
  // verification), so count those to cap mass username squatting per phone.
  const pendingDrafts = db
    .prepare(
      `SELECT COUNT(DISTINCT c.id) AS n
       FROM otp_challenges o JOIN creators c ON c.id = o.creator_id
       WHERE o.phone_e164 = ? AND c.status = 'draft'`,
    )
    .get(normalized).n;
  if (pendingDrafts >= config.maxDraftsPerPhone) {
    return { error: 'too_many_pending_claims' };
  }

  try {
    return transaction(() => {
      const creator = db
        .prepare(
          `INSERT INTO creators (username, display_name, username_reserved_until)
           VALUES (?, ?, datetime('now', ?))`,
        )
        .run(username.toLowerCase(), displayName.trim(), `+${config.reservationTtlSeconds} seconds`);
      const id = Number(creator.lastInsertRowid);
      return { creator: getCreatorById(id), phone: normalized };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { error: 'username_taken' };
    throw err;
  }
}

/** Sets the verified phone on a creator and makes the page publicly available. */
export function verifyCreatorPhone(creatorId, phone) {
  return transaction(() => {
    const clash = db.prepare('SELECT id FROM creators WHERE phone_e164 = ? AND id != ?').get(phone, creatorId);
    if (clash) return { error: 'phone_already_claimed' };
    const updated = db
      .prepare(
        `UPDATE creators
         SET phone_e164 = ?, phone_verified_at = COALESCE(phone_verified_at, datetime('now')),
             status = 'active', username_reserved_until = NULL, updated_at = datetime('now')
         WHERE id = ? AND status != 'suspended'`,
      )
      .run(phone, creatorId);
    if (updated.changes === 0) return { error: 'not_claimable' };
    return { creator: getCreatorById(creatorId) };
  });
}

/** Removes draft creators whose username reservation expired unverified. */
export function sweepExpiredReservations() {
  const expired = db
    .prepare(
      `SELECT id, username FROM creators
       WHERE status = 'draft' AND username_reserved_until IS NOT NULL AND username_reserved_until < datetime('now')`,
    )
    .all();
  for (const row of expired) {
    transaction(() => {
      db.prepare('DELETE FROM otp_challenges WHERE creator_id = ?').run(row.id);
      db.prepare('DELETE FROM creators WHERE id = ? AND status = \'draft\'').run(row.id);
    });
  }
  return expired.map((r) => r.username);
}

export function setKycState(creatorId, { status, ref = undefined, reason = null }) {
  return transaction(() => {
    const creator = getCreatorById(creatorId);
    if (!creator) return { error: 'not_found' };
    if (!KYC_STATUSES.includes(status)) return { error: 'invalid_state' };
    // Terminal approved/rejected states can only be left by an explicit
    // re-review (new applicant), not by a stale event arriving late.
    if ((creator.kyc_status === 'approved' || creator.kyc_status === 'rejected') && (status === 'pending' || status === 'none')) {
      return { outcome: 'ignored', creator };
    }
    db.prepare(
      `UPDATE creators SET kyc_status = ?,
         kyc_ref = CASE WHEN ? IS NOT NULL THEN ? ELSE kyc_ref END,
         kyc_provider = ?,
         kyc_reject_reason = ?,
         kyc_updated_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
    ).run(status, ref ?? null, ref ?? null, config.kycProvider, status === 'rejected' ? reason : null, creatorId);
    const fresh = getCreatorById(creatorId);
    if (status === 'approved') activatePayments(fresh);
    return { outcome: 'updated', creator: getCreatorById(creatorId) };
  });
}

/** Saves the payout account after the provider confirms the account name. */
export async function setPayoutAccount(creator, { bankCode, accountNumber }, provider = createPaymentProvider()) {
  if (!creator.phone_verified_at) return { error: 'phone_not_verified' };
  if (!/^[A-Za-z0-9\-]{2,12}$/.test(bankCode ?? '')) return { error: 'invalid_bank_code' };
  if (!/^\d{6,17}$/.test(accountNumber ?? '')) return { error: 'invalid_account_number' };

  let resolved;
  try {
    resolved = await provider.resolvePayoutAccount({ bankCode, accountNumber });
  } catch (err) {
    if (err instanceof ProviderError) return { error: 'account_verification_failed' };
    throw err;
  }

  db.prepare(
    `UPDATE creators SET payout_status = 'verified', bank_code = ?, bank_name = ?,
       bank_account_number = ?, bank_account_last4 = ?, payout_account_name = ?,
       payout_beneficiary_ref = ?, payout_updated_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
  ).run(bankCode, resolved.bankName ?? bankCode, accountNumber, accountNumber.slice(-4), resolved.accountName, resolved.beneficiaryRef, creator.id);

  const fresh = getCreatorById(creator.id);
  activatePayments(fresh);
  return { creator: getCreatorById(creator.id) };
}

/**
 * Activation gate: a page may only collect money once the phone is verified,
 * identity review is approved and a payout account is on file. Idempotent.
 */
export function activatePayments(creatorInput) {
  const creator = typeof creatorInput === 'number' ? getCreatorById(creatorInput) : creatorInput;
  if (!creator) return { error: 'not_found' };
  const eligible =
    Boolean(creator.phone_verified_at) &&
    creator.kyc_status === 'approved' &&
    creator.payout_status === 'verified' &&
    creator.status === 'active';
  if (!eligible) {
    if (creator.payments_active) {
      db.prepare(`UPDATE creators SET payments_active = 0, updated_at = datetime('now') WHERE id = ?`).run(creator.id);
      return { active: false, changed: true, creator: getCreatorById(creator.id) };
    }
    return { active: false, changed: false, creator: getCreatorById(creator.id) };
  }
  db.prepare(
    `UPDATE creators SET payments_active = 1, activated_at = COALESCE(activated_at, datetime('now')), updated_at = datetime('now')
     WHERE id = ?`,
  ).run(creator.id);
  return { active: true, changed: !creator.payments_active, creator: getCreatorById(creator.id) };
}

export function activationStates(creator) {
  return {
    pageCreated: true,
    phoneVerified: Boolean(creator.phone_verified_at),
    kycStatus: creator.kyc_status,
    payoutConfigured: creator.payout_status === 'verified',
    paymentsActive: Boolean(creator.payments_active),
    canAcceptPayments: Boolean(creator.payments_active) && creator.status === 'active',
  };
}

/** Username changes are rare, validated, uniqueness-checked and audited in-band. */
export function changeUsername(creator, username) {
  const usernameError = validateUsername(username);
  if (usernameError) return { error: usernameError };
  const normalized = username.toLowerCase();
  if (normalized === creator.username) return { creator };
  // Caller holds the transaction; the UNIQUE index decides collisions.
  try {
    db.prepare(`UPDATE creators SET username = ?, updated_at = datetime('now') WHERE id = ?`).run(normalized, creator.id);
    return { creator: getCreatorById(creator.id) };
  } catch (err) {
    if (isUniqueViolation(err)) return { error: 'That username is taken.', code: 'taken' };
    throw err;
  }
}
