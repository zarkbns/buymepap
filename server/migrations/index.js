/**
 * Ordered, forward-only migrations. Each `up` runs inside one IMMEDIATE
 * transaction, so a failed migration leaves the database untouched.
 *
 * Migration 1 is the legacy v1 layout (email+password creators, `supports`
 * tips, naira-denominated cup prices). It exists so a database created by the
 * old code is recognised and migrated in place instead of being reset.
 */

const LEGACY_V1 = `
  CREATE TABLE IF NOT EXISTS creators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    avatar_emoji TEXT NOT NULL DEFAULT '🥣',
    cup_price INTEGER NOT NULL DEFAULT 500,
    currency TEXT NOT NULL DEFAULT 'NGN',
    goal INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS supports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL REFERENCES creators(id),
    supporter_name TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    cups INTEGER NOT NULL DEFAULT 1,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'NGN',
    reference TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    is_anonymous INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_supports_creator_status
    ON supports (creator_id, status, id DESC);
`;

/**
 * The product rework: phone-OTP identity, KYC + payout state on the creator,
 * an explicit payments domain with fees, an append-only ledger, withdrawals
 * and a durable webhook event log. Existing rows are preserved: legacy
 * creators keep their username/page (payments stay off until they verify a
 * phone), and every historical successful tip is posted to the ledger exactly
 * as it was recorded (fee snapshot 0, because v1 had no fee concept).
 */
const V2_FINANCIAL_DOMAIN = `
  CREATE TABLE creators_v2 (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    avatar_emoji TEXT NOT NULL DEFAULT '🥣',
    cup_price_kobo INTEGER NOT NULL DEFAULT 50000,
    goal_kobo INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'NGN',

    phone_e164 TEXT UNIQUE,
    phone_verified_at TEXT,
    email TEXT,

    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','suspended')),
    username_reserved_until TEXT,

    kyc_status TEXT NOT NULL DEFAULT 'none'
      CHECK (kyc_status IN ('none','pending','approved','rejected','expired')),
    kyc_ref TEXT,
    kyc_provider TEXT,
    kyc_updated_at TEXT,
    kyc_reject_reason TEXT,

    payout_status TEXT NOT NULL DEFAULT 'none'
      CHECK (payout_status IN ('none','pending','verified','failed')),
    bank_code TEXT,
    bank_name TEXT,
    bank_account_last4 TEXT,
    payout_account_name TEXT,
    payout_beneficiary_ref TEXT,
    payout_updated_at TEXT,

    payments_active INTEGER NOT NULL DEFAULT 0,
    activated_at TEXT,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT INTO creators_v2
    (id, username, display_name, bio, avatar_emoji, cup_price_kobo, goal_kobo, currency,
     email, status, created_at)
  SELECT id, username, display_name, bio, avatar_emoji, cup_price * 100, goal * 100, currency,
         email, 'active', created_at
  FROM creators;

  DROP TABLE creators;
  ALTER TABLE creators_v2 RENAME TO creators;

  ALTER TABLE supports RENAME TO payments;
  DROP INDEX IF EXISTS idx_supports_creator_status;
  ALTER TABLE payments RENAME COLUMN amount TO amount_kobo;
  ALTER TABLE payments ADD COLUMN fee_kobo INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE payments ADD COLUMN net_kobo INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE payments ADD COLUMN fee_bps INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE payments ADD COLUMN provider TEXT NOT NULL DEFAULT 'legacy';
  ALTER TABLE payments ADD COLUMN provider_ref TEXT;
  ALTER TABLE payments ADD COLUMN supporter_email TEXT;
  ALTER TABLE payments ADD COLUMN credited_at TEXT;
  ALTER TABLE payments ADD COLUMN verified_at TEXT;
  ALTER TABLE payments ADD COLUMN updated_at TEXT;
  UPDATE payments SET updated_at = datetime('now') WHERE updated_at IS NULL;
  ALTER TABLE payments ADD COLUMN reconcile_status TEXT NOT NULL DEFAULT 'unreconciled'
    CHECK (reconcile_status IN ('unreconciled','reconciled','amount_mismatch','provider_gone'));

  UPDATE payments SET net_kobo = amount_kobo WHERE status = 'success';
  UPDATE payments SET reconcile_status = 'reconciled' WHERE status = 'success';

  CREATE TABLE otp_challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
    phone_e164 TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'claim' CHECK (purpose IN ('claim','signin')),
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_otp_challenges_phone ON otp_challenges (phone_e164, created_at DESC);

  CREATE TABLE withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL REFERENCES creators(id),
    amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0),
    fee_kobo INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'NGN',
    reference TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'requested'
      CHECK (status IN ('requested','processing','paid','failed','reversed')),
    provider TEXT NOT NULL,
    provider_ref TEXT,
    bank_code TEXT NOT NULL,
    bank_name TEXT,
    account_last4 TEXT NOT NULL,
    account_name TEXT,
    narration TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,
    failure_reason TEXT,
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    settled_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_withdrawals_creator ON withdrawals (creator_id, requested_at DESC);

  CREATE TABLE ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL REFERENCES creators(id),
    kind TEXT NOT NULL
      CHECK (kind IN ('payment_net','withdrawal_reserve','withdrawal_reversal','adjustment')),
    direction TEXT NOT NULL CHECK (direction IN ('credit','debit')),
    amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0),
    currency TEXT NOT NULL DEFAULT 'NGN',
    payment_id INTEGER REFERENCES payments(id),
    withdrawal_id INTEGER REFERENCES withdrawals(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_ledger_creator ON ledger_entries (creator_id, id);

  CREATE TABLE provider_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    event_key TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT '',
    reference TEXT,
    payload_sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'received'
      CHECK (status IN ('received','processed','ignored','failed')),
    error TEXT,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    UNIQUE (provider, event_key)
  );

  CREATE TABLE sms_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_e164 TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_payments_creator_status ON payments (creator_id, status, id DESC);
  CREATE INDEX idx_payments_provider_ref ON payments (provider_ref)
    WHERE provider_ref IS NOT NULL;
  CREATE INDEX idx_ledger_payment ON ledger_entries (payment_id) WHERE payment_id IS NOT NULL;
  CREATE INDEX idx_ledger_withdrawal ON ledger_entries (withdrawal_id) WHERE withdrawal_id IS NOT NULL;

  INSERT INTO ledger_entries
    (creator_id, kind, direction, amount_kobo, currency, payment_id, idempotency_key, description)
  SELECT creator_id, 'payment_net', 'credit', amount_kobo, currency, id,
         'payment:' || id || ':net', 'Migrated from legacy tip record'
  FROM payments
  WHERE status = 'success';
`;

export const MIGRATIONS = [
  { version: 1, name: 'legacy-v1-baseline', up: (db) => db.exec(LEGACY_V1) },
  {
    version: 2,
    name: 'financial-domain-v2',
    rebuildsTables: true,
    up: (db) => db.exec(V2_FINANCIAL_DOMAIN),
  },
];
