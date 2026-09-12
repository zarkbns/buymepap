import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startApp, api } from './helpers.js';

test('config endpoint reports the payments mode', async () => {
  const app = await startApp();
  const res = await api(app.base, '/api/config');
  assert.equal(res.status, 200);
  assert.equal(res.data.paymentsMode, 'mock');

  const health = await api(app.base, '/healthz');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  assert.equal(health.data.paymentsMode, 'mock');

  await app.close();
  fs.rmSync(app.dir, { recursive: true, force: true });
});
