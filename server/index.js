import { createApp } from './app.js';
import config from './config.js';
import { migrate } from './db.js';
import { sweepExpiredReservations } from './domain/onboarding.js';

// Deterministic startup: pending migrations run before the server accepts
// traffic, and a failed migration aborts the boot instead of half-serving.
const { from, to, applied } = migrate();
if (applied.length > 0) {
  console.log(`[buymepap] migrated ${from} -> ${to}: ${applied.join(', ')}`);
}
sweepExpiredReservations();

const app = createApp();

app.listen(config.port, () => {
  const secretNote = config.ephemeralSecret ? ' · EPHEMERAL SECRET (dev only)' : '';
  console.log(
    `[buymepap] ${config.env}${secretNote} · payments=${config.paymentsProvider} · kyc=${config.kycProvider} · sms=${config.smsProvider} · http://localhost:${config.port}`,
  );
});
