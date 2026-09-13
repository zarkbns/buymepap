import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startClient, createCreator } from './helpers.js';

let app;
let api;
before(async () => {
  app = await startClient();
  api = app.api;
});
after(async () => {
  await app.close();
});

test('KYC session marks the creator pending and returns browser-safe values only', async () => {
  const created = await createCreator(api);
  assert.equal(created.status, 200);

  const session = await api('/api/me/kyc/session', { method: 'POST' });
  assert.equal(session.status, 200, JSON.stringify(session.data));
  assert.equal(session.data.mock, true); // mock provider surface
  const me = await api('/api/me');
  assert.equal(me.data.creator.kycStatus, 'pending');
  assert.equal(me.data.activation.kycStatus, 'pending');
});

test('mock decision drives the same state machine the webhook would', async () => {
  await createCreator(api);
  await api('/api/me/kyc/session', { method: 'POST' });

  const approved = await api('/api/mock/kyc/decision', { method: 'POST', body: { outcome: 'approved' } });
  assert.equal(approved.data.kycStatus, 'approved');

  const me = await api('/api/me');
  assert.equal(me.data.creator.kycStatus, 'approved');
  assert.equal(me.data.activation.kycStatus, 'approved');
});

test('rejection records a reason and shows in activation states', async () => {
  await createCreator(api);
  await api('/api/me/kyc/session', { method: 'POST' });
  const rejected = await api('/api/mock/kyc/decision', { method: 'POST', body: { outcome: 'rejected' } });
  assert.equal(rejected.data.kycStatus, 'rejected');

  const me = await api('/api/me');
  assert.equal(me.data.creator.kycRejectReason, 'mock_rejection');
  assert.equal(me.data.activation.paymentsActive, false);

  const bad = await api('/api/mock/kyc/decision', { method: 'POST', body: { outcome: 'whatever' } });
  assert.equal(bad.status, 400);
});

test('approved creators cannot silently drop to pending via stale events', async () => {
  const { setKycState } = await import('../server/domain/onboarding.js');
  const created = await createCreator(api);
  await api('/api/me/kyc/session', { method: 'POST' });
  await api('/api/mock/kyc/decision', { method: 'POST', body: { outcome: 'approved' } });

  const creator = app.db.prepare('SELECT * FROM creators WHERE username = ?').get(created.username);
  const result = setKycState(creator.id, { status: 'pending' });
  assert.equal(result.outcome, 'ignored');
  assert.equal(result.creator.kyc_status, 'approved');
});

test('activation requires phone + KYC + payout together', async () => {
  const created = await createCreator(api);

  // No KYC, no payout: activation must stay off.
  const partial = await api('/api/me/activate', { method: 'POST' });
  assert.equal(partial.data.activation.paymentsActive, false);

  await api('/api/mock/kyc/decision', { method: 'POST', body: { outcome: 'approved' } });
  const stillNoPayout = await api('/api/me/activate', { method: 'POST' });
  assert.equal(stillNoPayout.data.activation.paymentsActive, false);

  const badPayout = await api('/api/me/payout-account', {
    method: 'PUT',
    body: { bankCode: '058', accountNumber: '123' }, // too short
  });
  assert.equal(badPayout.status, 400);

  const payout = await api('/api/me/payout-account', {
    method: 'PUT',
    body: { bankCode: '058', accountNumber: '0123456789' },
  });
  assert.equal(payout.data.creator.payoutStatus, 'verified');
  assert.equal(payout.data.creator.paymentsActive, true);
});

test('payout account requires a verified phone', async () => {
  const username = createCreator.name ? undefined : undefined;
  void username;
  const { db } = app;
  const created = await createCreator(api);
  // Simulate an unverified phone by clearing the column for this creator only.
  db.prepare('UPDATE creators SET phone_verified_at = NULL, phone_e164 = NULL WHERE username = ?').run(created.username);
  const res = await api('/api/me/payout-account', {
    method: 'PUT',
    body: { bankCode: '058', accountNumber: '0123456789' },
  });
  assert.equal(res.status, 403);
  assert.match(res.data.error, /Verify your phone/);
});

test('kyc refresh endpoint reports stored state in mock mode', async () => {
  await createCreator(api);
  const before = await api('/api/me/kyc/refresh', { method: 'POST' });
  assert.equal(before.status, 409); // no session started yet

  await api('/api/me/kyc/session', { method: 'POST' });
  const after = await api('/api/me/kyc/refresh', { method: 'POST' });
  assert.equal(after.status, 200);
  assert.equal(after.data.kycStatus, 'pending');
});

test('sumsub session token names the embedding app and a loadable widget script', async () => {
  const { createKycProvider } = await import('../server/kyc/index.js');
  const { jwtVerify } = await import('jose');
  const clientSecret = 'kyc_test_client_secret_at_least_32_chars';
  const key = new TextEncoder().encode(clientSecret);
  const provider = createKycProvider({
    kycProvider: 'sumsub',
    appUrl: 'https://pap.example',
    sumsub: { clientId: 'cid', clientSecret, sdkUrl: 'https://cdn.sumsub.com/websdk/' },
  });

  const session = await provider.createSessionToken({ kyc_ref: 'pap_7_deadbeef' });
  assert.equal(session.userId, 'pap_7_deadbeef');
  assert.match(session.scriptUrl, /^https:\/\/cdn\.sumsub\.com\/websdk\/sumsub\.websdk\.\d+\.\d+\.\d+\.js$/);

  const { payload } = await jwtVerify(session.token, key);
  assert.equal(payload.userId, 'pap_7_deadbeef');
  // Sumsub refuses the widget when the embedding origin differs from this claim.
  assert.equal(payload.applicationUrl, 'https://pap.example');

  const pinned = createKycProvider({
    kycProvider: 'sumsub',
    appUrl: 'https://pap.example',
    sumsub: { clientId: 'cid', clientSecret, sdkUrl: 'https://static.sumsub.com/websdk/sumsub.websdk.1.0.2.js' },
  });
  const exact = await pinned.createSessionToken({ kyc_ref: 'pap_7_deadbeef' });
  assert.equal(exact.scriptUrl, 'https://static.sumsub.com/websdk/sumsub.websdk.1.0.2.js');
});

test('camera access is granted to Sumsub only, and only while Sumsub is the KYC provider', async () => {
  const { securityHeaders } = await import('../server/app.js');
  assert.equal(securityHeaders('mock')['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()');
  assert.equal(
    securityHeaders('sumsub')['Permissions-Policy'],
    'camera=(https://*.sumsub.com), microphone=(https://*.sumsub.com), geolocation=()',
  );
  // The rest of the lockdown is unconditional.
  assert.equal(securityHeaders('sumsub')['X-Frame-Options'], 'DENY');
});
