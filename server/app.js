import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import config from './config.js';
import { authLimiter } from './limiters.js';
import authRoutes from './routes/auth.routes.js';
import creatorsRoutes from './routes/creators.routes.js';
import pagesRoutes from './routes/pages.routes.js';
import supportsRoutes from './routes/supports.routes.js';
import webhooksRoutes from './routes/webhooks.routes.js';
import mockRoutes from './routes/mock.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.get('/healthz', (req, res) => res.json({ ok: true, paymentsMode: config.paystackMode }));

  app.use('/api/webhooks', webhooksRoutes);
  app.use(express.json({ limit: '64kb' }));

  app.use('/api/auth', authLimiter, authRoutes);
  app.get('/api/config', (req, res) => res.json({ paymentsMode: config.paystackMode }));
  app.use('/api', creatorsRoutes);
  app.use('/api/pages', pagesRoutes);
  app.use('/api/supports', supportsRoutes);
  app.use('/api/mock', mockRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  const dist = path.join(config.root, 'dist');
  const indexHtml = path.join(dist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        res.sendFile(indexHtml);
      } else {
        next();
      }
    });
  }

  app.use((err, req, res, next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large.' });
    console.error('[buymepap]', err);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}
