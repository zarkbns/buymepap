import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

let counter = 0;

export function uniqueName(prefix = 'creator') {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`.toLowerCase();
}

export function uniquePhone() {
  counter += 1;
  return `+23480${String(10000000 + (Date.now() % 10000000)).slice(0, 8)}${counter % 10}`;
}

/**
 * Boots the app against a throwaway database. Each test file runs in its own
 * node:test process, so module-level singletons (config, db, limiter stores)
 * are per-file by construction. RATE_LIMIT_SCALE is raised unless the file
 * pins it first — rate-limit tests set it to 1 *before* calling startApp.
 */
export async function startApp({ env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buymepap-test-'));
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.PAP_DB_PATH = path.join(dir, 'test.db');
  if (process.env.RATE_LIMIT_SCALE === undefined) process.env.RATE_LIMIT_SCALE = '100';
  Object.assign(process.env, env);

  const [{ createApp }, { default: db, migrate }] = await Promise.all([
    import('../server/app.js'),
    import('../server/db.js'),
  ]);
  migrate();

  const server = createApp().listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  const close = () =>
    new Promise((resolve) => {
      server.close(resolve);
      fs.rmSync(dir, { recursive: true, force: true });
    });

  return { base, db, dir, close };
}

/**
 * Tiny browser: keeps the session + CSRF cookies the server hands out and
 * replays them (with the CSRF header) on every request, like the frontend's
 * same-origin fetch would.
 */
function makeClient(base) {
  let jar = {};
  const client = async (pathname, { method = 'GET', body, token } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (Object.keys(jar).length > 0) headers.Cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (jar.buymepap_csrf) headers['X-CSRF-Token'] = jar.buymepap_csrf;
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const cookie of res.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
    return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
  };
  client.jar = () => jar;
  // Fresh anonymous session: warm up with a GET so the server sets the CSRF
  // cookie, exactly like a browser loading the SPA before any POST.
  client.clearJar = async () => {
    jar = {};
    await client('/api/config');
  };
  return client;
}

export async function startClient() {
  const app = await startApp();
  const api = makeClient(app.base);
  await api('/api/config'); // warm-up GET so the CSRF cookie exists before tests POST
  return { ...app, api };
}

/** Drives the full claim → OTP → verify flow and returns the signed-in creator. */
export async function createCreator(api, { username, phone, displayName = 'Ada Nwosu' } = {}) {
  username = username ?? uniqueName();
  phone = phone ?? uniquePhone();
  const claim = await api('/api/auth/claim', {
    method: 'POST',
    body: { username, displayName, phone },
  });
  if (claim.status !== 201) return { ...claim, username, phone };
  const sms = await api(`/api/mock/sms/latest?phone=${encodeURIComponent(phone)}`);
  const code = sms.data.body?.match(/\d{4,8}/)?.[0];
  const verify = await api('/api/auth/otp/verify', { method: 'POST', body: { code } });
  return { ...verify, username, phone, code };
}

/** Fully activates a creator: KYC approved, payout account, payments on. */
export async function activateCreator(api, { cupPrice = 500 } = {}) {
  const created = await createCreator(api);
  assert.equal(created.status, 200, JSON.stringify(created.data));
  await api('/api/me', { method: 'PATCH', body: { cupPrice } });
  const kyc = await api('/api/mock/kyc/decision', { method: 'POST', body: { outcome: 'approved' } });
  assert.equal(kyc.status, 200, JSON.stringify(kyc.data));
  const payout = await api('/api/me/payout-account', {
    method: 'PUT',
    body: { bankCode: '058', accountNumber: '0123456789' },
  });
  assert.equal(payout.status, 200, JSON.stringify(payout.data));
  const activate = await api('/api/me/activate', { method: 'POST' });
  assert.equal(activate.data.activation.paymentsActive, true, JSON.stringify(activate.data));
  return { ...created, username: created.username };
}

/** Charges a pending payment through the mock provider path. */
export async function mockCharge(api, reference, outcome = 'success') {
  const res = await api('/api/mock/payments/charge', { method: 'POST', body: { reference, outcome } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data;
}

export async function support(api, username, body = { cups: 1, name: 'Chidi', isAnonymous: false }) {
  return api(`/api/pages/${username}/supports`, { method: 'POST', body });
}
