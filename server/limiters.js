import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import config from './config.js';

const scale = Math.max(1, config.rateLimitScale);

function limiter({ windowMs, limit, keyGenerator, message }) {
  return rateLimit({
    windowMs,
    limit: Math.max(1, Math.ceil(limit * scale)),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: keyGenerator ?? ((req) => ipKeyGenerator(req.ip)),
    message: { error: message ?? 'Too many requests. Try again in a few minutes.' },
  });
}

/**
 * Built per app instance so tests (and multi-app embedders) never share
 * buckets. SCALE keeps shared-IP dev/test traffic from tripping the buckets
 * accidentally; the dedicated rate-limit tests pin it to 1.
 */
export function createLimiters() {
  return {
    // Username claiming: expensive (creates rows + sends SMS).
    claim: limiter({ windowMs: 60 * 60 * 1000, limit: 10, message: 'Too many attempts to claim a page. Try again later.' }),

    // OTP delivery: real money per SMS, so tight per-phone and per-IP buckets.
    otpRequest: limiter({
      windowMs: 15 * 60 * 1000,
      limit: 5,
      message: 'Too many codes requested. Wait a few minutes and try again.',
      keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.phone ?? req.session?.phone ?? '')}`,
    }),
    otpVerify: limiter({
      windowMs: 15 * 60 * 1000,
      limit: 12,
      message: 'Too many wrong codes. Wait a few minutes and try again.',
      keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.phone ?? req.session?.phone ?? '')}`,
    }),

    // Public page reads stay cheap; payments are the guarded step.
    pageRead: limiter({ windowMs: 60 * 1000, limit: 120 }),
    paymentInit: limiter({
      windowMs: 60 * 60 * 1000,
      limit: 30,
      message: 'Too many payment attempts. Try again in a few minutes.',
    }),
    withdraw: limiter({
      windowMs: 60 * 60 * 1000,
      limit: 10,
      keyGenerator: (req) => `creator:${req.creator?.id ?? ipKeyGenerator(req.ip)}`,
      message: 'Too many withdrawal attempts. Try again later.',
    }),
    kycSession: limiter({
      windowMs: 60 * 60 * 1000,
      limit: 20,
      keyGenerator: (req) => `creator:${req.creator?.id ?? ipKeyGenerator(req.ip)}`,
      message: 'Too many verification sessions. Try again later.',
    }),

    // Webhook endpoints: authenticated by signature, but still bounded.
    webhook: limiter({ windowMs: 60 * 1000, limit: 600, message: { error: 'Webhook rate exceeded.' } }),
  };
}
