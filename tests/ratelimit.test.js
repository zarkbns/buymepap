// Rate-limit tests must run with the real limits: set the scale BEFORE any
// app import. Each test file is its own process, so this cannot leak.
process.env.RATE_LIMIT_SCALE = '1';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startClient, activateCreator, uniqueName, uniquePhone } from './helpers.js';

let app;
let api;
before(async () => {
  app = await startClient();
  api = app.api;
});
after(async () => {
  await app.close();
});

test('OTP delivery is rate limited per phone+IP', async () => {
  const phone = uniquePhone();
  const claim = await api('/api/auth/claim', {
    method: 'POST',
    body: { username: uniqueName(), displayName: 'Ada', phone },
  });
  assert.equal(claim.status, 201);

  const otherPhone = uniquePhone();
  let hitLimit = false;
  let last = 0;
  for (let i = 0; i < 12 && !hitLimit; i += 1) {
    const res = await api('/api/auth/otp/request', { method: 'POST', body: { phone: otherPhone } });
    last = res.status;
    if (res.status === 429) hitLimit = true;
  }
  assert.equal(hitLimit, true, `expected 429 for repeated OTP requests (last ${last})`);
});

test('OTP verification is rate limited', async () => {
  const phone = uniquePhone();
  await api('/api/auth/claim', { method: 'POST', body: { username: uniqueName(), displayName: 'Ada', phone } });
  let hitLimit = false;
  for (let i = 0; i < 20 && !hitLimit; i += 1) {
    const res = await api('/api/auth/otp/verify', { method: 'POST', body: { code: '000000' } });
    if (res.status === 429) hitLimit = true;
  }
  assert.equal(hitLimit, true, 'expected 429 after repeated wrong codes');
});

test('username claiming is rate limited per IP', async () => {
  let hitLimit = false;
  for (let i = 0; i < 15 && !hitLimit; i += 1) {
    const res = await api('/api/auth/claim', {
      method: 'POST',
      body: { username: uniqueName('rl'), displayName: 'Ada', phone: uniquePhone() },
    });
    if (res.status === 429) hitLimit = true;
  }
  assert.equal(hitLimit, true, 'expected 429 on mass claiming');
});

test('payment initialization is rate limited with its own bucket', async () => {
  const fresh = await startClient(); // fresh limiter stores, same scale
  const created = await activateCreator(fresh.api, { cupPrice: 500 });

  let hitLimit = false;
  let last = 0;
  for (let i = 0; i < 45 && !hitLimit; i += 1) {
    const res = await fresh.api(`/api/pages/${created.username}/supports`, {
      method: 'POST',
      body: { cups: 1, name: 'X', isAnonymous: false },
    });
    last = res.status;
    if (res.status === 429) hitLimit = true;
  }
  assert.equal(hitLimit, true, `expected 429 on mass payment init (last ${last})`);
  await fresh.close();
});
