import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startApp, api, signupCreator, uniqueName } from './helpers.js';

let app;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test('signup validates every field', async () => {
  const cases = [
    { email: 'not-an-email', password: 'longenough1', username: 'ada_dev', displayName: 'Ada' },
    { email: 'ada@example.com', password: 'short', username: 'ada_dev', displayName: 'Ada' },
    { email: 'ada@example.com', password: 'longenough1', username: 'A!', displayName: 'Ada' },
    { email: 'ada@example.com', password: 'longenough1', username: 'ada_dev', displayName: '  ' },
    { email: 'ada@example.com', password: 'longenough1', username: 'api', displayName: 'Ada' },
  ];
  for (const body of cases) {
    const res = await api(app.base, '/api/auth/signup', { method: 'POST', body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(res.data.error);
  }
});

test('signup returns token and public creator, rejects duplicates', async () => {
  const username = uniqueName();
  const body = {
    email: `${username}@example.com`,
    password: 'longenough1',
    username,
    displayName: 'Ada Dev',
  };
  const first = await api(app.base, '/api/auth/signup', { method: 'POST', body });
  assert.equal(first.status, 201);
  assert.ok(first.data.token);
  assert.equal(first.data.creator.username, username);
  assert.equal(first.data.creator.email, undefined);
  assert.equal(first.data.creator.password_hash, undefined);

  const dupeEmail = await api(app.base, '/api/auth/signup', {
    method: 'POST',
    body: { ...body, username: uniqueName() },
  });
  assert.equal(dupeEmail.status, 409);

  const dupeUser = await api(app.base, '/api/auth/signup', {
    method: 'POST',
    body: { ...body, email: `other-${username}@example.com` },
  });
  assert.equal(dupeUser.status, 409);
});

test('login works and rejects wrong credentials', async () => {
  const created = await signupCreator(app.base);
  assert.equal(created.status, 201);

  const ok = await api(app.base, '/api/auth/login', {
    method: 'POST',
    body: { email: `${created.username}@example.com`, password: 'correct-horse-battery' },
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);

  const badPassword = await api(app.base, '/api/auth/login', {
    method: 'POST',
    body: { email: `${created.username}@example.com`, password: 'wrong-password-0' },
  });
  assert.equal(badPassword.status, 401);

  const ghost = await api(app.base, '/api/auth/login', {
    method: 'POST',
    body: { email: 'ghost@example.com', password: 'whatever-12345' },
  });
  assert.equal(ghost.status, 401);
});

test('/api/me requires a valid session', async () => {
  const anon = await api(app.base, '/api/me');
  assert.equal(anon.status, 401);

  const created = await signupCreator(app.base);
  const me = await api(app.base, '/api/me', { token: created.data.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.creator.username, created.username);

  const garbage = await api(app.base, '/api/me', { token: 'not.a.jwt' });
  assert.equal(garbage.status, 401);
});
