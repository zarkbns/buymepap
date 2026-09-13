import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // No .env file — the real environment is used as-is.
}

export const PAYMENTS_PROVIDERS = ['flutterwave', 'mock'];
export const KYC_PROVIDERS = ['sumsub', 'mock'];
export const SMS_PROVIDERS = ['http', 'mock'];

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

function str(name, fallback = '') {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : String(raw).trim();
}

function int(name, fallback) {
  const raw = str(name, '');
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be a whole number (got "${raw}").`);
  return value;
}

function bool(name, fallback) {
  const raw = str(name, '').toLowerCase();
  if (raw === '') return fallback;
  return raw === '1' || raw === 'true';
}

const port = int('PORT', 8787);

const config = {
  root,
  env,
  isProd,
  port,
  appUrl: str('APP_URL', `http://localhost:${port}`),
  dbPath: str('PAP_DB_PATH', path.join(root, 'data', 'buymepap.db')),
  trustProxyHops: int('TRUST_PROXY_HOPS', 1),
  bodyLimit: str('BODY_LIMIT', '32kb'),
  rateLimitScale: int('RATE_LIMIT_SCALE', 1),

  // Session signing. In production this must be an explicit secret; see validateConfig.
  jwtSecret: str('JWT_SECRET'),
  sessionCookie: str('SESSION_COOKIE_NAME', 'buymepap_session'),
  sessionTtlSeconds: int('SESSION_TTL_SECONDS', 30 * 24 * 60 * 60),
  cookieSecure: bool('COOKIE_SECURE', isProd),
  cookieSameSite: str('COOKIE_SAMESITE', 'lax'),
  csrfCookie: str('CSRF_COOKIE_NAME', 'buymepap_csrf'),
  allowedOrigins: str('ALLOWED_ORIGINS', '')
    .split(',')
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean),

  // Money is integer-only, in kobo (1 NGN = 100 kobo). Never a float.
  currency: str('CURRENCY', 'NGN'),
  platformFeeBasisPoints: int('PLATFORM_FEE_BASIS_POINTS', 0),
  minSupportKobo: int('MIN_SUPPORT_KOBO', 100),
  maxSupportKobo: int('MAX_SUPPORT_KOBO', 1_000_000_000),
  minWithdrawalKobo: int('MIN_WITHDRAWAL_KOBO', 100_000),
  maxWithdrawalKobo: int('MAX_WITHDRAWAL_KOBO', 10_000_000),
  maxOpenWithdrawals: int('MAX_OPEN_WITHDRAWALS', 3),

  // Creator onboarding / reservations
  reservationTtlSeconds: int('USERNAME_RESERVATION_TTL_SECONDS', 7 * 24 * 60 * 60),
  maxDraftsPerPhone: int('MAX_DRAFTS_PER_PHONE', 5),
  otpCodeLength: int('OTP_CODE_LENGTH', 6),
  otpTtlSeconds: int('OTP_TTL_SECONDS', 600),
  otpMaxAttempts: int('OTP_MAX_ATTEMPTS', 6),
  otpPepper: str('OTP_PEPPER', ''),

  paymentsProvider: str('PAYMENTS_PROVIDER', isProd ? 'flutterwave' : 'mock').toLowerCase(),
  kycProvider: str('KYC_PROVIDER', isProd ? 'sumsub' : 'mock').toLowerCase(),
  smsProvider: str('SMS_PROVIDER', isProd ? 'http' : 'mock').toLowerCase(),

  flutterwave: {
    baseUrl: str('FLUTTERWAVE_BASE_URL', 'https://api.flutterwave.com/v3'),
    secretKey: str('FLUTTERWAVE_SECRET_KEY'),
    publicKey: str('FLUTTERWAVE_PUBLIC_KEY'),
    entitySid: str('FLUTTERWAVE_ENTITY_SID'),
    webhookHash: str('FLUTTERWAVE_WEBHOOK_HASH'),
    timeoutMs: int('FLUTTERWAVE_TIMEOUT_MS', 20000),
  },

  sumsub: {
    baseUrl: str('SUMSUB_BASE_URL', 'https://api.sumsub.com'),
    sdkUrl: str('SUMSUB_SDK_URL', 'https://cdn.sumsub.com/websdk'),
    clientId: str('SUMSUB_CLIENT_ID'),
    clientSecret: str('SUMSUB_CLIENT_SECRET'),
    webhookSecret: str('SUMSUB_WEBHOOK_SECRET'),
    levelId: str('SUMSUB_LEVEL_ID'),
    timeoutMs: int('SUMSUB_TIMEOUT_MS', 20000),
  },

  sms: {
    url: str('SMS_HTTP_URL'),
    token: str('SMS_HTTP_TOKEN'),
    senderId: str('SMS_SENDER_ID', 'BuyMePap'),
    timeoutMs: int('SMS_TIMEOUT_MS', 15000),
  },

  adminToken: str('ADMIN_TOKEN'),
};

/** The mock checkout / mock KYC / OTP-echo surface must never exist in production. */
config.mockEndpointsEnabled = !isProd;

export function configProblems(cfg) {
  const problems = [];

  if (cfg.isProd) {
    if (cfg.jwtSecret.length < 32) {
      problems.push(
        'JWT_SECRET must be a random secret of at least 32 characters — otherwise every restart mints a new one and sessions cannot be invalidated deliberately.',
      );
    }
    if (!/^https:\/\//.test(cfg.appUrl)) problems.push('APP_URL must be an https:// URL in production.');
    if (!cfg.cookieSecure) problems.push('COOKIE_SECURE must be true in production (Secure cookie attribute).');
    if (cfg.cookieSameSite === 'none') problems.push('COOKIE_SAMESITE=none is refused; stay on "lax" and rely on CSRF checks.');
  }

  if (!PAYMENTS_PROVIDERS.includes(cfg.paymentsProvider)) {
    problems.push(`PAYMENTS_PROVIDER must be one of: ${PAYMENTS_PROVIDERS.join(', ')}.`);
  }
  if (!KYC_PROVIDERS.includes(cfg.kycProvider)) problems.push(`KYC_PROVIDER must be one of: ${KYC_PROVIDERS.join(', ')}.`);
  if (!SMS_PROVIDERS.includes(cfg.smsProvider)) problems.push(`SMS_PROVIDER must be one of: ${SMS_PROVIDERS.join(', ')}.`);

  if (cfg.paymentsProvider === 'flutterwave') {
    const f = cfg.flutterwave;
    if (!f.secretKey) problems.push('FLUTTERWAVE_SECRET_KEY is required when PAYMENTS_PROVIDER=flutterwave.');
    if (!f.publicKey) problems.push('FLUTTERWAVE_PUBLIC_KEY is required when PAYMENTS_PROVIDER=flutterwave.');
    if (!f.entitySid) problems.push('FLUTTERWAVE_ENTITY_SID is required when PAYMENTS_PROVIDER=flutterwave.');
    if (!f.webhookHash) problems.push('FLUTTERWAVE_WEBHOOK_HASH is required to reject forged payment webhooks.');
    if (f.secretKey.startsWith('sk_test_')) problems.push('FLUTTERWAVE_SECRET_KEY is a test key while NODE_ENV=production.');
  }

  if (cfg.kycProvider === 'sumsub') {
    const s = cfg.sumsub;
    if (!s.clientId) problems.push('SUMSUB_CLIENT_ID is required when KYC_PROVIDER=sumsub.');
    if (!s.clientSecret) problems.push('SUMSUB_CLIENT_SECRET is required when KYC_PROVIDER=sumsub.');
    if (!s.webhookSecret) problems.push('SUMSUB_WEBHOOK_SECRET is required to reject forged KYC webhooks.');
  }

  if (cfg.smsProvider === 'http') {
    if (!cfg.sms.url) problems.push('SMS_HTTP_URL is required when SMS_PROVIDER=http.');
    if (!cfg.sms.token) problems.push('SMS_HTTP_TOKEN is required when SMS_PROVIDER=http.');
  }

  if (cfg.isProd && cfg.smsProvider === 'mock') problems.push('SMS_PROVIDER=mock cannot deliver OTP codes in production.');

  if (cfg.platformFeeBasisPoints < 0 || cfg.platformFeeBasisPoints > 2500) {
    problems.push('PLATFORM_FEE_BASIS_POINTS must be between 0 and 2500 (0%–25%).');
  }
  if (cfg.minSupportKobo < 1 || cfg.maxSupportKobo < cfg.minSupportKobo) {
    problems.push('MIN_SUPPORT_KOBO must be >= 1 and <= MAX_SUPPORT_KOBO.');
  }
  if (cfg.minWithdrawalKobo < 1 || cfg.maxWithdrawalKobo < cfg.minWithdrawalKobo) {
    problems.push('MIN_WITHDRAWAL_KOBO must be >= 1 and <= MAX_WITHDRAWAL_KOBO.');
  }
  if (cfg.otpCodeLength < 4 || cfg.otpCodeLength > 8) problems.push('OTP_CODE_LENGTH must be between 4 and 8.');
  if (cfg.otpMaxAttempts < 3 || cfg.otpMaxAttempts > 20) problems.push('OTP_MAX_ATTEMPTS must be between 3 and 20.');
  if (!/^[a-z]{3}$/.test(cfg.currency.toLowerCase())) problems.push('CURRENCY must be a 3-letter code.');

  return problems;
}

export function validateConfig(cfg = config) {
  const problems = configProblems(cfg);
  if (!problems.length) return;
  const list = problems.map((p) => `  - ${p}`).join('\n');
  if (cfg.isProd) {
    throw new Error(
      `Refusing to start: configuration is not production-safe (NODE_ENV=production)\n${list}\nSee .env.example for what each variable means.`,
    );
  }
  for (const p of problems) console.warn(`[buymepap] config: ${p}`);
}

validateConfig(config);

if (!config.jwtSecret) {
  // Non-production only: an ephemeral secret keeps `npm run dev` working while
  // making it obvious that sessions will not survive a restart.
  config.jwtSecret = crypto.randomBytes(32).toString('hex');
  config.ephemeralSecret = true;
}

// OTP codes are short, so they are stored keyed by a server-side pepper rather
// than as a bare digest an attacker could precompute.
if (!config.otpPepper) config.otpPepper = config.jwtSecret;

export default config;
