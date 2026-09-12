import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startApp } from './helpers.js';

test('webhook is inactive without a Paystack key', async () => {
  const app = await startApp();
  const res = await fetch(`${app.base}/api/webhooks/paystack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'irrelevant' },
    body: JSON.stringify({ event: 'charge.success', data: { reference: 'pap_nope' } }),
  });
  assert.equal(res.status, 503);

  await app.close();
  fs.rmSync(app.dir, { recursive: true, force: true });
});
