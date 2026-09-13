import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startApp } from './helpers.js';

const run = promisify(execFile);

let app;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
});

test('health and config endpoints report the active providers', async () => {
  const config = await fetch(`${app.base}/api/config`).then((r) => r.json());
  assert.equal(config.paymentsProvider, 'mock');
  assert.equal(config.kycProvider, 'mock');

  const health = await fetch(`${app.base}/healthz`).then((r) => r.json());
  assert.equal(health.ok, true);
  assert.equal(health.paymentsProvider, 'mock');
  assert.equal(health.kycProvider, 'mock');
  assert.equal(health.smsProvider, 'mock');
});

test('config endpoints expose no secrets or provider details', async () => {
  const health = await fetch(`${app.base}/healthz`).then((r) => r.json());
  const text = JSON.stringify(health);
  for (const marker of ['secret', 'key', 'token', 'hash']) {
    assert.equal(text.toLowerCase().includes(marker), false, marker);
  }
});

test('production boot refuses missing JWT_SECRET', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-boot-'));
  try {
    await assert.rejects(
      run(process.execPath, ['--eval', "await import('./server/config.js')"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'production',
          PAP_DB_PATH: path.join(dir, 'p.db'),
          JWT_SECRET: '',
          RATE_LIMIT_SCALE: '1',
        },
      }),
      /Refusing to start|JWT_SECRET/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('production boot accepts an explicit strong secret', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-boot2-'));
  try {
    const { stdout } = await run(
      process.execPath,
      ['--eval', "const { default: config } = await import('./server/config.js'); console.log(config.isProd);"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'production',
          PAP_DB_PATH: path.join(dir, 'p.db'),
          JWT_SECRET: 'a'.repeat(48),
          APP_URL: 'https://app.test',
          PAYMENTS_PROVIDER: 'flutterwave',
          FLUTTERWAVE_SECRET_KEY: 'flw_sk_placeholder_not_a_real_key',
          FLUTTERWAVE_PUBLIC_KEY: 'flw_pk_placeholder',
          FLUTTERWAVE_ENTITY_SID: 'sid_placeholder',
          FLUTTERWAVE_WEBHOOK_HASH: 'hash_placeholder',
          KYC_PROVIDER: 'sumsub',
          SUMSUB_CLIENT_ID: 'id_placeholder',
          SUMSUB_CLIENT_SECRET: 'secret_placeholder',
          SUMSUB_WEBHOOK_SECRET: 'webhook_placeholder',
          SMS_PROVIDER: 'http',
          SMS_HTTP_URL: 'https://sms.test/send',
          SMS_HTTP_TOKEN: 'token_placeholder',
          RATE_LIMIT_SCALE: '1',
        },
      },
    );
    assert.match(stdout, /true/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('configProblems flags every production insecurity at once', async () => {
  const { configProblems } = await import('../server/config.js');
  const problems = configProblems({
    isProd: true,
    jwtSecret: 'short',
    appUrl: 'http://app.test',
    cookieSecure: false,
    cookieSameSite: 'lax',
    paymentsProvider: 'flutterwave',
    kycProvider: 'sumsub',
    smsProvider: 'mock',
    flutterwave: { secretKey: '', publicKey: '', entitySid: '', webhookHash: '' },
    sumsub: { clientId: '', clientSecret: '', webhookSecret: '' },
    sms: { url: '', token: '' },
    platformFeeBasisPoints: 0,
    minSupportKobo: 1,
    maxSupportKobo: 100,
    minWithdrawalKobo: 1,
    maxWithdrawalKobo: 2,
    otpCodeLength: 6,
    otpMaxAttempts: 6,
    currency: 'NGN',
  });
  assert.ok(problems.some((p) => p.includes('JWT_SECRET')));
  assert.ok(problems.some((p) => p.includes('https')));
  assert.ok(problems.some((p) => p.includes('COOKIE_SECURE')));
  assert.ok(problems.some((p) => p.includes('FLUTTERWAVE_SECRET_KEY')));
  assert.ok(problems.some((p) => p.includes('FLUTTERWAVE_WEBHOOK_HASH')));
  assert.ok(problems.some((p) => p.includes('SUMSUB_CLIENT_ID')));
  assert.ok(problems.some((p) => p.includes('SMS_PROVIDER=mock')));
});

test('integer-money helpers refuse unsafe values', async () => {
  const { assertKobo } = await import('../server/money.js');
  assert.throws(() => assertKobo(1.5));
  assert.throws(() => assertKobo(-1));
  assert.throws(() => assertKobo(Number.MAX_SAFE_INTEGER + 1));
});
