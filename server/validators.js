const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMOJI_RE = /^\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*$/u;

const RESERVED_USERNAMES = new Set([
  'api', 'admin', 'root', 'me', 'about', 'terms', 'privacy', 'explore',
  'login', 'logout', 'signup', 'settings', 'dashboard', 'pages', 'supports',
  'webhooks', 'assets', 'static', 'src', 'vendor', 'favicon.ico',
  'mock-checkout', 'buymepap', 'buymeacoffee',
]);

export function validateUsername(username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3-20 characters: lowercase letters, numbers and underscores.';
  }
  if (RESERVED_USERNAMES.has(username)) return 'That username is reserved.';
  return null;
}

export function validateEmail(email) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 254) {
    return 'Enter a valid email address.';
  }
  return null;
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return 'Password must be 8-128 characters.';
  }
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

export function validateCupPrice(price) {
  if (!Number.isInteger(price) || price < 1 || price > 100000) {
    return 'Price per pap must be a whole number between 1 and 100000.';
  }
  return null;
}

export function validateGoal(goal) {
  if (!Number.isInteger(goal) || goal < 0 || goal > 100000000) {
    return 'Goal must be a whole number between 0 and 100000000.';
  }
  return null;
}

export function validateSupportInput({ cups, name, message, isAnonymous }) {
  if (!Number.isInteger(cups) || cups < 1 || cups > 100) {
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

export const MAX_AMOUNT_KOBO = 1_000_000_000;
