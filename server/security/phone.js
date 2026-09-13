import crypto from 'node:crypto';
import config from '../config.js';

/** Naira payment references, e.g. pap_9f2c… — unique per payment attempt. */
export function newPaymentReference() {
  return `pap_${crypto.randomBytes(10).toString('hex')}`;
}

export function newWithdrawalReference() {
  return `wdl_${crypto.randomBytes(8).toString('hex')}`;
}

export function newOpaqueId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Normalises a phone number to E.164. Nigeria-first: local 11-digit numbers
 * (0801…) get the +234 prefix; anything already international is validated.
 * Returns null for input that cannot be a routable MSISDN.
 */
export function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[\s\-().]/g, '');
  let e164;
  if (digits.startsWith('+')) {
    e164 = `+${digits.slice(1)}`;
  } else if (/^0\d{10}$/.test(digits)) {
    e164 = `+234${digits.slice(1)}`;
  } else if (/^\d{7,15}$/.test(digits)) {
    e164 = `+${digits}`;
  } else {
    return null;
  }
  if (!/^\+\d{7,15}$/.test(e164)) return null;
  return e164;
}

/** Normalised display form for SMS, e.g. +234801… */
export function maskPhone(e164) {
  if (typeof e164 !== 'string' || e164.length < 6) return '***';
  return `${e164.slice(0, 4)}****${e164.slice(-3)}`;
}

/** HMAC of an OTP code with the server-side pepper, so the DB never holds the raw code. */
export function hashOtpCode(phone, code) {
  return crypto.createHmac('sha256', config.otpPepper).update(`${phone}:${code}`).digest('hex');
}

export function otpCodesMatch(phone, code, expectedHash) {
  const actual = Buffer.from(hashOtpCode(phone, code), 'hex');
  let expected;
  try {
    expected = Buffer.from(String(expectedHash), 'hex');
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function generateOtpCode(length = config.otpCodeLength) {
  return crypto.randomInt(0, 10 ** length).toString().padStart(length, '0');
}
