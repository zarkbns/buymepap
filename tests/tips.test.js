import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startApp, api, signupCreator } from './helpers.js';

let app;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

async function createSupport(base, username, body) {
  const res = await api(base, `/api/pages/${username}/supports`, { method: 'POST', body });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data;
}

async function mockCharge(base, reference, outcome) {
  const res = await api(base, '/api/mock/paystack/charge', {
    method: 'POST',
    body: { reference, outcome },
  });
  assert.equal(res.status, 200);
  return res.data;
}

test('full support loop: initialize → charge → verify → wall', async () => {
  const s = await signupCreator(app.base);
  await api(app.base, '/api/me', { method: 'PATCH', token: s.data.token, body: { cupPrice: 500 } });

  const created = await createSupport(app.base, s.username, {
    cups: 2,
    name: 'Chidi',
    message: 'Your newsletter slaps!',
    isAnonymous: false,
  });
  assert.equal(created.amountKobo, 100000);
  assert.ok(created.authorizationUrl.startsWith('/mock-checkout?reference='));

  const beforeWall = await api(app.base, `/api/pages/${s.username}`);
  assert.equal(beforeWall.data.supporters.length, 0);
  assert.equal(beforeWall.data.stats.cups, 0);

  const pending = await api(app.base, `/api/mock/paystack/pending?reference=${created.reference}`);
  assert.equal(pending.status, 200);
  assert.equal(pending.data.amountKobo, 100000);
  assert.equal(pending.data.creator.username, s.username);

  const charged = await mockCharge(app.base, created.reference, 'success');
  assert.equal(charged.status, 'success');

  const verified = await api(app.base, `/api/supports/${created.reference}/verify`);
  assert.equal(verified.status, 200);
  assert.equal(verified.data.status, 'success');
  assert.equal(verified.data.support.name, 'Chidi');
  assert.equal(verified.data.support.message, 'Your newsletter slaps!');

  const afterWall = await api(app.base, `/api/pages/${s.username}`);
  assert.equal(afterWall.data.supporters.length, 1);
  assert.equal(afterWall.data.stats.cups, 2);
});

test('anonymous support hides the name from the wall but not the dashboard', async () => {
  const s = await signupCreator(app.base);
  const created = await createSupport(app.base, s.username, {
    cups: 1,
    name: 'Funke',
    message: 'Anon tip',
    isAnonymous: true,
  });
  await mockCharge(app.base, created.reference, 'success');

  const page = await api(app.base, `/api/pages/${s.username}`);
  assert.equal(page.data.supporters.length, 1);
  assert.equal(page.data.supporters[0].name, null);

  const dash = await api(app.base, '/api/me/dashboard', { token: s.data.token });
  assert.equal(dash.status, 200);
  assert.equal(dash.data.recent[0].name, 'Funke');
  assert.equal(dash.data.recent[0].isAnonymous, true);
  assert.ok(dash.data.stats.earnedKobo >= 50000);
});

test('failed charge never reaches the wall', async () => {
  const s = await signupCreator(app.base);
  const created = await createSupport(app.base, s.username, {
    cups: 1,
    name: 'Tunde',
    message: '',
    isAnonymous: false,
  });
  const charged = await mockCharge(app.base, created.reference, 'failed');
  assert.equal(charged.status, 'failed');

  const verified = await api(app.base, `/api/supports/${created.reference}/verify`);
  assert.equal(verified.data.status, 'failed');
  assert.equal(verified.data.support, null);

  const page = await api(app.base, `/api/pages/${s.username}`);
  assert.equal(page.data.supporters.length, 0);
});

test('duplicate charges on one reference are idempotent', async () => {
  const s = await signupCreator(app.base);
  const created = await createSupport(app.base, s.username, { cups: 3, name: 'Emeka', isAnonymous: false });
  await mockCharge(app.base, created.reference, 'success');
  await mockCharge(app.base, created.reference, 'success');

  const page = await api(app.base, `/api/pages/${s.username}`);
  assert.equal(page.data.supporters.length, 1);
  assert.equal(page.data.stats.cups, 3);
});

test('support input validation', async () => {
  const s = await signupCreator(app.base);
  const bad = [
    { cups: 0, name: 'X', isAnonymous: false },
    { cups: 101, name: 'X', isAnonymous: false },
    { cups: 1.5, name: 'X', isAnonymous: false },
    { cups: 1, name: '   ', isAnonymous: false },
    { cups: 1, name: 'X', message: 'x'.repeat(501), isAnonymous: false },
    { cups: 1, name: 'X', isAnonymous: 'yes' },
    { cups: 1, name: 'X', isAnonymous: false, email: 'bad-email' },
  ];
  for (const body of bad) {
    const res = await api(app.base, `/api/pages/${s.username}/supports`, { method: 'POST', body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }

  const ghost = await api(app.base, '/api/pages/nobody/supports', {
    method: 'POST',
    body: { cups: 1, name: 'X', isAnonymous: false },
  });
  assert.equal(ghost.status, 404);
});
