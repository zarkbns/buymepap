import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let counter = 0;

export async function startApp({ paystackKey } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buymepap-test-'));
  process.env.PAP_DB_PATH = path.join(dir, 'test.db');
  if (paystackKey) process.env.PAYSTACK_SECRET_KEY = paystackKey;
  const { createApp } = await import('../server/app.js');
  const server = createApp().listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const db = (await import('../server/db.js')).default;
  const close = () => new Promise((resolve) => server.close(resolve));
  return { base, db, dir, close };
}

export async function api(base, pathname, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

export function uniqueName(prefix = 'ada') {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

export async function signupCreator(base, overrides = {}) {
  const username = uniqueName();
  const payload = {
    email: `${username}@example.com`,
    password: 'correct-horse-battery',
    username,
    displayName: 'Ada N',
    ...overrides,
  };
  const res = await api(base, '/api/auth/signup', { method: 'POST', body: payload });
  return { ...res, username };
}
