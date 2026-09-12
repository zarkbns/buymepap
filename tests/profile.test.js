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

test('PATCH /api/me updates profile fields', async () => {
  const s = await signupCreator(app.base);
  const res = await api(app.base, '/api/me', {
    method: 'PATCH',
    token: s.data.token,
    body: { displayName: 'Ada Big', bio: 'I write things.', avatarEmoji: '🥣', cupPrice: 1200, goal: 50000 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.creator.displayName, 'Ada Big');
  assert.equal(res.data.creator.bio, 'I write things.');
  assert.equal(res.data.creator.cupPrice, 1200);
  assert.equal(res.data.creator.goal, 50000);
});

test('PATCH rejects invalid values and empty bodies', async () => {
  const s = await signupCreator(app.base);
  const cases = [
    { bio: 'x'.repeat(301) },
    { cupPrice: 0 },
    { cupPrice: 1.5 },
    { avatarEmoji: 'not an emoji' },
    { goal: -1 },
    {},
  ];
  for (const body of cases) {
    const res = await api(app.base, '/api/me', { method: 'PATCH', token: s.data.token, body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('public page reflects profile and hides private fields', async () => {
  const s = await signupCreator(app.base);
  await api(app.base, '/api/me', {
    method: 'PATCH',
    token: s.data.token,
    body: { bio: 'Public bio.' },
  });
  const page = await api(app.base, `/api/pages/${s.username}`);
  assert.equal(page.status, 200);
  assert.equal(page.data.creator.bio, 'Public bio.');
  assert.equal('email' in page.data.creator, false);
  assert.equal('password_hash' in page.data.creator, false);
});

test('unknown creator is 404', async () => {
  const res = await api(app.base, '/api/pages/nobody_here');
  assert.equal(res.status, 404);
});
