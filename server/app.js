import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import config from './config.js';
import { createLimiters } from './limiters.js';
import { loadSession, requireSameOrigin, ensureCsrfCookie } from './security/session.js';
import authRoutes from './routes/auth.routes.js';
import meRoutes from './routes/me.routes.js';
import pagesRoutes from './routes/pages.routes.js';
import paymentsRoutes from './routes/payments.routes.js';
import webhooksRoutes from './routes/webhooks.routes.js';
import mockRoutes from './routes/mock.routes.js';
import banksRoutes from './routes/banks.routes.js';
import adminRoutes from './routes/admin.routes.js';

// Sumsub's WebSDK captures an ID document and a selfie inside its own
// cross-origin frame, and a document-level camera denial cannot be delegated
// into that frame. So the camera is granted to Sumsub origins only, and only
// while Sumsub is the configured KYC provider — every other policy stays
// locked down, including in mock/dev where no capture ever happens.
export function securityHeaders(kycProvider = config.kycProvider) {
  const capture = kycProvider === 'sumsub' ? '(https://*.sumsub.com)' : '()';
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': `camera=${capture}, microphone=${capture}, geolocation=()`,
  };
}

const SECURITY_HEADERS = securityHeaders();

function allowedOrigin(origin) {
  if (!origin) return null; // same-origin / curl
  if (config.allowedOrigins.length === 0) return null; // CORS layer disabled: rely on same-origin deploy
  return config.allowedOrigins.includes(origin.toLowerCase()) ? origin : undefined;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);

  const limiters = createLimiters();
  app.set('limiters', limiters);

  app.use((req, res, next) => {
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(header, value);
    next();
  });

  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true,
      paymentsProvider: config.paymentsProvider,
      kycProvider: config.kycProvider,
      smsProvider: config.smsProvider,
    });
  });

  // Webhooks verify their own signatures over the raw body and are CSRF-exempt
  // (no cookies are involved).
  app.use('/api/webhooks', limiters.webhook, webhooksRoutes);

  app.use(express.json({ limit: config.bodyLimit }));

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const origin = allowedOrigin(req.headers.origin);
    if (config.allowedOrigins.length > 0 && req.headers.origin) {
      if (!origin) return res.status(403).json({ error: 'Origin not allowed.' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE');
    }
    next();
  });

  app.use(loadSession);

  // CSRF guard for unsafe methods (webhooks handled above).
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      ensureCsrfCookie(req, res);
      return next();
    }
    requireSameOrigin(req, res) === null ? undefined : next();
  });

  app.use('/api/auth', authRoutes);
  app.get('/api/config', (_req, res) => {
    res.json({ paymentsProvider: config.paymentsProvider, kycProvider: config.kycProvider, currency: config.currency });
  });
  app.use('/api', meRoutes);
  app.use('/api/pages', limiters.pageRead, pagesRoutes);
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/banks', banksRoutes);
  app.use('/api/mock', mockRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  const dist = path.join(config.root, 'dist');
  const indexHtml = path.join(dist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexHtml);
      } else {
        next();
      }
    });
  }

  // eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature.
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large.' });
    console.error('[buymepap]', err?.message ?? err);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}
