import { normalizePhone } from './security/phone.js';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const EMOJI_RE = /^\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*$/u;

/** Names that would impersonate the platform or collide with app routes. */
const RESERVED_USERNAMES = new Set([
  'api', 'admin', 'root', 'me', 'about', 'terms', 'privacy', 'explore',
  'login', 'logout', 'signup', 'settings', 'dashboard', 'pages', 'supports',
  'webhooks', 'assets', 'static', 'src', 'vendor', 'favicon.ico',
  'mock-checkout', 'kyc', 'kyc-return', 'auth', 'verify', 'withdraw',
  'buymepap', 'buymeacoffee', 'support', 'help', 'security', 'official',
]);

export function validateUsername(username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3-20 characters: lowercase letters, numbers and underscores.';
  }
  if (RESERVED_USERNAMES.has(username)) return 'That username is reserved.';
  return null;
}

export function validateDisplayName(name) {
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 40) {
    return 'Display name must be 1-40 characters.';
  }
  return null;
}

export function validateBio(bio) {
  if (typeof bio !== 'string' || bio.length > 300) {
    return 'Bio must be 300 characters or fewer.';
  }
  return null;
}

export function validateAvatarEmoji(emoji) {
  if (typeof emoji !== 'string' || !EMOJI_RE.test(emoji) || emoji.length > 12) {
    return 'Avatar must be a single emoji.';
  }
  return null;
}

/** Cup price in naira (UI unit); stored as kobo downstream. */
export function validateNairaAmount(value, { min = 1, max = 100_000 } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    return `Amount must be a whole number between ${min} and ${max}.`;
  }
  return null;
}

export function validateSupportInput({ cups, name, message, isAnonymous }) {
  if (!Number.isSafeInteger(cups) || cups < 1 || cups > 100) {
    return 'Cups of pap must be between 1 and 100.';
  }
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 30) {
    return 'Your name must be 1-30 characters.';
  }
  if (typeof message !== 'string' || message.length > 500) {
    return 'Message must be 500 characters or fewer.';
  }
  if (typeof isAnonymous !== 'boolean') {
    return 'Invalid anonymity flag.';
  }
  return null;
}

export function validateEmail(email) {
  if (email === undefined || email === null || email === '') return null;
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Enter a valid email address.';
  }
  return null;
}

export function normalizePhoneInput(phone) {
  return normalizePhone(phone);
}

export function validateAccountNumber(accountNumber) {
  if (typeof accountNumber !== 'string' || !/^\d{6,17}$/.test(accountNumber)) {
    return 'Account number must be 6-17 digits.';
  }
  return null;
}

export function validateBankCode(bankCode) {
  if (typeof bankCode !== 'string' || !/^[A-Za-z0-9\-]{2,12}$/.test(bankCode)) {
    return 'Select a valid bank.';
  }
  return null;
}

export function validateWithdrawalKobo(amountKobo) {
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
    return 'Amount must be a positive whole number of kobo.';
  }
  return null;
}
