import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startClient, activateCreator, support, mockCharge, createCreator, uniqueName, uniquePhone } from './helpers.js';

let app;
let api;
before(async () => {
  app = await startClient();
  api = app.api;
});
after(async () => {
  await app.close();
});

test('profile updates validate inputs and kobo conversion', async () => {
  const created = await createCreator(api);
  const res = await api('/api/me', {
    method: 'PATCH',
    body: { displayName: 'Ada Big', bio: 'I write.', avatarEmoji: '🎙️', cupPrice: 1200, goal: 25000 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.creator.cupPriceKobo, 120000);
  assert.equal(res.data.creator.goalKobo, 2500000);

  const bad = [
    { bio: 'x'.repeat(301) },
    { cupPrice: 0 },
    { cupPrice: 1.5 },
    { avatarEmoji: 'not an emoji' },
    { goal: -1 },
    { username: 'bad name!' },
  ];
  for (const body of bad) {
    const res2 = await api('/api/me', { method: 'PATCH', body });
    assert.equal(res2.status, 400, JSON.stringify(body));
  }
  const empty = await api('/api/me', { method: 'PATCH', body: {} });
  assert.equal(empty.status, 400);
});

test('username changes collide safely', async () => {
  const a = await createCreator(api, { username: uniqueName() });
  const b = await createCreator(api, { username: uniqueName() });

  const clash = await api('/api/me', { method: 'PATCH', body: { username: a.username } });
  assert.equal(clash.status, 409);

  const rename = await api('/api/me', { method: 'PATCH', body: { username: uniqueName() } });
  assert.equal(rename.status, 200);
  void b;
});

test('creator-owned resources are scoped to the session', async () => {
  const a = await activateCreator(api);
  const b = await createCreator(api);

  // B's dashboard must never include A's data.
  const dash = await api('/api/me/dashboard');
  assert.equal(dash.data.creator.username, b.username);
  void a;

  const init = await support(api, a.username, { cups: 1, name: 'X', isAnonymous: false });
  await mockCharge(api, init.data.reference, 'success');
  const bDash = await api('/api/me/dashboard');
  assert.equal(bDash.data.recent.find((p) => p.reference === init.data.reference), undefined);
});

test('public pages hide private fields entirely', async () => {
  const created = await activateCreator(api);
  const page = await api(`/api/pages/${created.username}`);
  const creator = page.data.creator;
  for (const forbidden of ['phone', 'phone_e164', 'phoneVerified', 'kycStatus', 'kyc_ref', 'payoutStatus', 'bankAccountLast4', 'payout_account_name', 'email', 'password_hash', 'status', 'reservedUntil']) {
    assert.equal(forbidden in creator, false, forbidden);
  }
  assert.equal('canAcceptPayments' in creator, true);
});

test('auth-required endpoints reject anonymous callers', async () => {
  await api.clearJar();
  const warm = await api('/api/config');
  assert.equal(warm.status, 200);
  const endpoints = [
    ['GET', '/api/me'],
    ['GET', '/api/me/dashboard'],
    ['POST', '/api/me/withdrawals'],
    ['POST', '/api/me/kyc/session'],
    ['PUT', '/api/me/payout-account'],
  ];
  for (const [method, path] of endpoints) {
    const res = await api(path, { method, body: method === 'GET' ? undefined : {} });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
  const phone = uniquePhone();
  void phone;
});

test('admin endpoints are inert without a token', async () => {
  const res = await api('/api/admin/payments/pap_x/reconcile', { method: 'POST' });
  assert.equal(res.status, 404);
  const sweep = await api('/api/admin/maintenance/sweep-reservations', { method: 'POST' });
  assert.equal(sweep.status, 404);
});
