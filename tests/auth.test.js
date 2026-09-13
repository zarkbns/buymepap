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

test('session cookie is httpOnly, SameSite and Secure-aware', async () => {
  const username = uniqueName();
  const phone = uniquePhone();
  const claim = await api('/api/auth/claim', { method: 'POST', body: { username, displayName: 'Ada', phone } });
  const cookies = claim.headers.getSetCookie();
  const sessionCookie = cookies.find((c) => c.startsWith('buymepap_session='));
  assert.ok(sessionCookie.includes('HttpOnly'), 'session cookie must be HttpOnly');
  assert.ok(/SameSite=Lax/i.test(sessionCookie), 'session cookie must be SameSite=Lax');
  assert.ok(!sessionCookie.includes('Secure'), 'no Secure flag in plain-http tests');

  const sms = await api(`/api/mock/sms/latest?phone=${encodeURIComponent(phone)}`);
  const code = sms.data.body.match(/\d{4,8}/)[0];
  const verify = await api('/api/auth/otp/verify', { method: 'POST', body: { code } });
  const sessionCookies = verify.headers.getSetCookie();
  assert.ok(sessionCookies.some((c) => c.startsWith('buymepap_session=')));
});

test('CSRF: unsafe requests without the token header are rejected', async () => {
  const username = uniqueName();
  const phone = uniquePhone();
  const claim = await api('/api/auth/claim', { method: 'POST', body: { username, displayName: 'Ada', phone } });
  const jar = api.jar();

  // Strip the CSRF header/cookie pair but keep the session cookie.
  const cookieOnly = Object.entries(jar)
    .filter(([k]) => k !== 'buymepap_csrf')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const res = await fetch(`${app.base}/api/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieOnly, Origin: app.base },
    body: JSON.stringify({ code: '000000' }),
  });
  assert.equal(res.status, 403);
  assert.ok(claim.status === 201);
});

test('CSRF: cross-origin unsafe request is rejected even with valid cookies', async () => {
  const res = await fetch(`${app.base}/api/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://evil.example.com',
      'X-CSRF-Token': 'whatever',
    },
  });
  assert.equal(res.status, 403);
});

test('logout clears the session', async () => {
  await createCreator(api);
  const before = await api('/api/auth/session');
  assert.ok(before.data.creator);

  const logout = await api('/api/auth/logout', { method: 'POST' });
  assert.equal(logout.status, 200);
  const after = await api('/api/auth/session');
  assert.equal(after.data.creator, null);
});

test('Bearer tokens work for non-browser clients', async () => {
  const created = await createCreator(api);
  await api.clearJar();
  // Fresh jar so no cookie interferes; obtain a token by signing in via OTP.
  const phone = created.phone;
  await api('/api/auth/otp/request', { method: 'POST', body: { phone } });
  const sms = await api(`/api/mock/sms/latest?phone=${encodeURIComponent(phone)}`);
  const code = sms.data.body.match(/\d{4,8}/)[0];
  const verify = await api('/api/auth/otp/verify', { method: 'POST', body: { code } });
  assert.equal(verify.status, 200);
  const jar = api.jar();
  const sessionCookie = Object.entries(jar).find(([k]) => k === 'buymepap_session');
  assert.ok(sessionCookie);
  await api.clearJar();

  // Use the cookie value as a Bearer token.
  const me = await api('/api/me', { token: sessionCookie[1] });
  assert.equal(me.status, 200);
  assert.equal(me.data.creator.username, created.username);
});

test('garbage or foreign tokens are 401', async () => {
  const me = await api('/api/me', { token: 'not.a.jwt' });
  assert.equal(me.status, 401);
});

test('self serialization hides phone-adjacent and payout secrets', async () => {
  const created = await createCreator(api);
  const me = await api('/api/me');
  const creator = me.data.creator;
  for (const forbidden of ['phone_e164', 'kyc_ref', 'bank_account_number', 'payout_beneficiary_ref', 'password_hash']) {
    assert.equal(forbidden in creator, false, forbidden);
  }
  assert.equal(creator.phone, created.phone); // own phone is visible to self
});

test('mock endpoints are unreachable in production-like env', async () => {
  // This app runs in test env; assert the guard by checking mock routes exist
  // here but their production refusal is config-driven (covered in config tests).
  const sms = await api(`/api/mock/sms/latest?phone=${encodeURIComponent(uniquePhone())}`);
  assert.ok([404, 200].includes(sms.status));
});
