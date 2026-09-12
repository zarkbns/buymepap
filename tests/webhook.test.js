import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { startApp, api, signupCreator } from './helpers.js';

const KEY = 'sk_test_webhook_harness';
const reference = 'pap_webhook_test_1';

let app;
let username;

before(async () => {
  app = await startApp({ paystackKey: KEY });
  const s = await signupCreator(app.base);
  username = s.username;
  const creator = app.db.prepare('SELECT * FROM creators WHERE username = ?').get(username);
  app.db
    .prepare(
      `INSERT INTO supports (creator_id, supporter_name, message, cups, amount, currency, reference)
       VALUES (?, 'Webhook Fan', 'via webhook', 1, 100000, 'NGN', ?)`
    )
    .run(creator.id, reference);
});

after(async () => {
  await app.close();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

function signedBody(event, data) {
  const body = JSON.stringify({ event, data });
  return { body, signature: crypto.createHmac('sha512', KEY).update(Buffer.from(body)).digest('hex') };
}

async function postWebhook({ body, signature }) {
  return fetch(`${app.base}/api/webhooks/paystack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature },
    body,
  });
}

test('valid charge.success webhook fulfills the support', async () => {
  const event = signedBody('charge.success', { reference, status: 'success', amount: 100000 });
  const res = await postWebhook(event);
  assert.equal(res.status, 200);

  const page = await api(app.base, `/api/pages/${username}`);
  assert.equal(page.data.supporters.length, 1);
  assert.equal(page.data.supporters[0].message, 'via webhook');
});

test('replayed webhook is idempotent', async () => {
  const event = signedBody('charge.success', { reference });
  const res = await postWebhook(event);
  assert.equal(res.status, 200);

  const page = await api(app.base, `/api/pages/${username}`);
  assert.equal(page.data.supporters.length, 1);
});

test('forged signature is rejected', async () => {
  const creator = app.db.prepare('SELECT * FROM creators WHERE username = ?').get(username);
  app.db
    .prepare(
      `INSERT INTO supports (creator_id, supporter_name, message, cups, amount, currency, reference)
       VALUES (?, 'Mallory', 'forged', 1, 100000, 'NGN', 'pap_forged_1')`
    )
    .run(creator.id);

  const event = signedBody('charge.success', { reference: 'pap_forged_1' });
  const res = await postWebhook({ body: event.body, signature: 'ab'.repeat(128) });
  assert.equal(res.status, 401);

  const row = app.db.prepare('SELECT status FROM supports WHERE reference = ?').get('pap_forged_1');
  assert.equal(row.status, 'pending');
});

test('unknown reference is a no-op', async () => {
  const event = signedBody('charge.success', { reference: 'pap_does_not_exist' });
  const res = await postWebhook(event);
  assert.equal(res.status, 200);
});

test('mock checkout endpoints are disabled in live mode', async () => {
  const charge = await api(app.base, '/api/mock/paystack/charge', {
    method: 'POST',
    body: { reference, outcome: 'success' },
  });
  assert.equal(charge.status, 404);

  const pending = await api(app.base, `/api/mock/paystack/pending?reference=${reference}`);
  assert.equal(pending.status, 404);
});
