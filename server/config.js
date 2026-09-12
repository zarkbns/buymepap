import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const port = Number(process.env.PORT || 8787);

const config = {
  root,
  port,
  env: process.env.NODE_ENV || 'development',
  dbPath: process.env.PAP_DB_PATH || path.join(root, 'data', 'buymepap.db'),
  jwtSecret: process.env.JWT_SECRET || '',
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || '',
  appUrl: process.env.APP_URL || `http://localhost:${port}`,
};

if (!config.jwtSecret) {
  config.jwtSecret = crypto.randomBytes(32).toString('hex');
  if (config.env === 'production') {
    console.warn('[buymepap] JWT_SECRET is not set — sessions will reset on restart. Set JWT_SECRET before going live.');
  }
}

config.paystackMode = config.paystackSecretKey ? 'paystack' : 'mock';

export default config;
