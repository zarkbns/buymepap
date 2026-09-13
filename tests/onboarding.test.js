import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startClient, createCreator, uniqueName, uniquePhone } from './helpers.js';

let app;
let api;
before(async () => {
  app = await startClient();
  api = app.api;
});
after(async () => {
  await app.close();
});

test('claim validates username, display name and phone', async () => {
  const bad = [
    { username: 'A!', displayName: 'Ada', phone: '+2348012345678' },
    { username: 'ab', displayName: 'Ada', phone: '+2348012345678' },
    { username: 'admin', displayName: 'Ada', phone: '+2348012345678' },
    { username: 'buymepap', displayName: 'Ada', phone: '+2348012345678' },
    { username: uniqueName(), displayName: '  ', phone: '+2348012345678' },
    { username: uniqueName(), displayName: 'Ada', phone: 'not-a-phone' },
    { username: uniqueName(), displayName: 'Ada', phone: '12345' },
    {},
  ];
  for (const body of bad) {
    const res = await api('/api/auth/claim', { method: 'POST', body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('claiming a taken username 409s even with a different phone', async () => {
  const username = uniqueName();
  const first = await createCreator(api, { username });
  assert.equal(first.status, 200, JSON.stringify(first.data));

  const second = await api('/api/auth/claim', {
    method: 'POST',
    body: { username, displayName: 'Impostor', phone: uniquePhone() },
  });
  assert.equal(second.status, 409);
});

test('one phone can only hold one page', async () => {
  const phone = uniquePhone();
  const first = await createCreator(api, { username: uniqueName(), phone });
  assert.equal(first.status, 200);

  const second = await api('/api/auth/claim', {
    method: 'POST',
    body: { username: uniqueName(), displayName: 'Ada', phone },
  });
  assert.equal(second.status, 409);
  assert.match(second.data.error, /already has a page/);
});

test('wrong OTP code is rejected with attempt tracking', async () => {
  const username = uniqueName();
  const phone = uniquePhone();
  const claim = await api('/api/auth/claim', {
    method: 'POST',
    body: { username, displayName: 'Ada', phone },
  });
  assert.equal(claim.status, 201);

  for (let i = 0; i < 3; i += 1) {
    const res = await api('/api/auth/otp/verify', { method: 'POST', body: { code: '000000' } });
    assert.equal(res.status, 400);
    assert.equal(res.data.reason, 'invalid');
  }
});

test('correct OTP consumes the challenge (single use)', async () => {
  const username = uniqueName();
  const phone = uniquePhone();
  await api('/api/auth/claim', { method: 'POST', body: { username, displayName: 'Ada', phone } });
  const sms = await api(`/api/mock/sms/latest?phone=${encodeURIComponent(phone)}`);
  const code = sms.data.body.match(/\d{4,8}/)[0];

  const first = await api('/api/auth/otp/verify', { method: 'POST', body: { code } });
  assert.equal(first.status, 200);
  assert.equal(first.data.creator.username, username);
  assert.equal(first.data.creator.phone, phone);
  assert.equal(first.data.creator.phoneVerified, true);
  assert.equal('phone_e164' in first.data.creator, false);
  assert.equal('kyc_ref' in first.data.creator, false);

  await api.clearJar();
  const replay = await api('/api/auth/otp/verify', { method: 'POST', body: { code } });
  assert.equal(replay.status, 401); // no pending session anymore

  // Even with a fresh pending session for another claim, the consumed code is dead.
  const other = await api('/api/auth/claim', {
    method: 'POST',
    body: { username: uniqueName(), displayName: 'Ada', phone: uniquePhone() },
  });
  assert.equal(other.status, 201);
  const replay2 = await api('/api/auth/otp/verify', { method: 'POST', body: { code } });
  assert.equal(replay2.status, 400);
});

test('expired OTP challenges are refused', async () => {
  const username = uniqueName();
  const phone = uniquePhone();
  await api('/api/auth/claim', { method: 'POST', body: { username, displayName: 'Ada', phone } });
  const sms = await api(`/api/mock/sms/latest?phone=${encodeURIComponent(phone)}`);
  const code = sms.data.body.match(/\d{4,8}/)[0];

  app.db.prepare(`UPDATE otp_challenges SET expires_at = datetime('now', '-1 minute')`).run();
  const res = await api('/api/auth/otp/verify', { method: 'POST', body: { code } });
  assert.equal(res.status, 400);
  assert.equal(res.data.reason, 'expired');
});

test('too many wrong codes burn the challenge', async () => {
  const username = uniqueName();
  const phone = uniquePhone();
  await api('/api/auth/claim', { method: 'POST', body: { username, displayName: 'Ada', phone } });
  const sms = await api(`/api/mock/sms/latest?phone=${encodeURIComponent(phone)}`);
  const code = sms.data.body.match(/\d{4,8}/)[0];

  // config.otpMaxAttempts defaults to 6: five wrong codes are "invalid",
  // the sixth burns the challenge and the route answers 429.
  for (let i = 0; i < 5; i += 1) {
    const res = await api('/api/auth/otp/verify', { method: 'POST', body: { code: '111111' } });
    assert.equal(res.status, 400);
  }
  const burned = await api('/api/auth/otp/verify', { method: 'POST', body: { code: '111111' } });
  assert.equal(burned.status, 429);
  assert.equal(burned.data.reason, 'too_many_attempts');
  // The real code is now also dead because the challenge was consumed.
  const res = await api('/api/auth/otp/verify', { method: 'POST', body: { code } });
  assert.equal(res.status, 400);
  assert.equal(res.data.reason, 'expired', 'challenge is burned once attempts run out');
});

test('a phone cannot squat unlimited draft pages', async () => {
  const phone = uniquePhone();
  // config.maxDraftsPerPhone defaults to 5: five pending claims succeed…
  for (let i = 0; i < 5; i += 1) {
    const res = await api('/api/auth/claim', {
      method: 'POST',
      body: { username: uniqueName('squat'), displayName: 'Ada', phone },
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
  }
  // …and the sixth is refused until one is verified or swept.
  const sixth = await api('/api/auth/claim', {
    method: 'POST',
    body: { username: uniqueName('squat'), displayName: 'Ada', phone },
  });
  assert.equal(sixth.status, 409);
  assert.match(sixth.data.error, /pending page claims/);
});

test('unverified draft pages are not publicly visible', async () => {
  const username = uniqueName();
  const phone = uniquePhone();
  await api('/api/auth/claim', { method: 'POST', body: { username, displayName: 'Ada', phone } });

  const page = await api(`/api/pages/${username}`);
  assert.equal(page.status, 404);
});

test('expired reservations release the username via sweep', async () => {
  const username = uniqueName();
  const phone = uniquePhone();
  await api('/api/auth/claim', { method: 'POST', body: { username, displayName: 'Ada', phone } });

  // Age the draft past its reservation window and sweep.
  app.db.prepare(`UPDATE creators SET username_reserved_until = datetime('now', '-1 minute')`).run();
  const sweep = await api('/api/auth/maintenance/sweep', { method: 'POST' });
  assert.equal(sweep.status, 200);
  assert.ok(sweep.data.released.includes(username));

  // The username is claimable again; the abandoned row is gone.
  const row = app.db.prepare('SELECT * FROM creators WHERE username = ?').get(username);
  assert.equal(row, undefined);

  const reclaimer = await createCreator(api, { username });
  assert.equal(reclaimer.status, 200);
});

test('verified pages survive the sweep', async () => {
  const created = await createCreator(api);
  app.db.prepare(`UPDATE creators SET username_reserved_until = datetime('now', '-1 minute')`).run();
  const sweep = await api('/api/auth/maintenance/sweep', { method: 'POST' });
  assert.equal(sweep.data.released.includes(created.username), false);
  const page = await api(`/api/pages/${created.username}`);
  assert.equal(page.status, 200);
});

test('sign-in by phone OTP works and does not enumerate unknown phones', async () => {
  const phone = uniquePhone();
  await createCreator(api, { username: uniqueName(), phone });
  await api.clearJar();

  const request = await api('/api/auth/otp/request', { method: 'POST', body: { phone } });
  assert.equal(request.status, 200);
  const sms = await api(`/api/mock/sms/latest?phone=${encodeURIComponent(phone)}`);
  const code = sms.data.body.match(/\d{4,8}/)[0];
  const verify = await api('/api/auth/otp/verify', { method: 'POST', body: { code } });
  assert.equal(verify.status, 200);
  assert.equal(verify.data.creator.phone, phone);

  await api.clearJar();
  const warm = await api('/api/config');
  assert.equal(warm.status, 200);
  const ghost = await api('/api/auth/otp/request', { method: 'POST', body: { phone: uniquePhone() } });
  assert.equal(ghost.status, 200);
  assert.equal(ghost.data.sent, true);
  // Nothing verifiable was created for the ghost phone: verify without pending session fails.
  const noSession = await api('/api/auth/otp/verify', { method: 'POST', body: { code: '123456' } });
  assert.equal(noSession.status, 401);
});
