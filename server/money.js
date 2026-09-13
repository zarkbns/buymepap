/**
 * Every amount in BuyMePap is an integer in the smallest unit of the currency
 * (kobo for NGN). Nothing here may use floating-point arithmetic, and nothing
 * that has already been recorded is ever recomputed from live configuration —
 * the ledger stores the exact figure that moved.
 */

export const KOBO_PER_NAIRA = 100;

export function assertKobo(value, label = 'amount') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer in kobo, got ${String(value)}`);
  }
  return value;
}

/**
 * Platform fee in kobo, rounded down so a creator is never short-changed by a
 * fraction of a kobo that cannot be settled.
 */
export function feeKobo(amountKobo, basisPoints) {
  assertKobo(amountKobo, 'amountKobo');
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new TypeError(`basisPoints must be an integer between 0 and 10000, got ${String(basisPoints)}`);
  }
  return Math.floor((amountKobo * basisPoints) / 10_000);
}

/** gross -> { gross, fee, net } with the invariant gross === fee + net. */
export function splitAmount(amountKobo, basisPoints) {
  const gross = assertKobo(amountKobo, 'amountKobo');
  const fee = feeKobo(gross, basisPoints);
  return { gross, fee, net: gross - fee };
}

/** Exact kobo -> major-unit string ("1234.56"). Never round-trips through a float. */
export function koboToMajorString(kobo) {
  assertKobo(kobo, 'kobo');
  const whole = Math.trunc(kobo / KOBO_PER_NAIRA);
  const frac = kobo % KOBO_PER_NAIRA;
  return `${whole}.${String(frac).padStart(2, '0')}`;
}

/**
 * Exact major-unit -> kobo. Accepts an integer, a decimal string or a number
 * with at most two fractional digits; anything finer is refused instead of
 * silently rounded.
 */
export function majorToKobo(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('amount is not a number');
    return majorToKobo(String(value));
  }
  if (typeof value !== 'string') throw new TypeError('amount must be a string or number');
  const text = value.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new TypeError(`cannot parse money amount "${text}"`);
  const whole = Number(match[1]);
  const frac = match[2] ? Number(match[2].padEnd(2, '0')) : 0;
  const kobo = whole * KOBO_PER_NAIRA + frac;
  if (!Number.isSafeInteger(kobo)) throw new TypeError(`amount "${text}" is too large to represent safely`);
  return kobo;
}

/** Integer-only money formatting for display, e.g. ₦1,234.50. */
export function formatKobo(kobo, symbol = '₦') {
  const safe = assertKobo(Number(kobo) || 0, 'kobo');
  const whole = Math.trunc(safe / KOBO_PER_NAIRA);
  const frac = safe % KOBO_PER_NAIRA;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === 0 ? `${symbol}${grouped}` : `${symbol}${grouped}.${String(frac).padStart(2, '0')}`;
}
