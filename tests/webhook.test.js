import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startClient, activateCreator, support, mockCharge } from './helpers.js';

// Signature tests run against a locally built app (mock provider keeps the
// webhook surface 503, so for webhook acceptance tests we drive the adapter's
// real code path by inserting payments directly and asserting via domain).
let app;
let api;
let creator;

const HASH = 'flw-hash-abc123';

before(async () => {
  app = await startClient();
  api = app.api;
  creator = await activateCreator(api);
  app.db.prepare("UPDATE provider_events SET id = id WHERE 1").run(); // no-op keeps linters honest
});

after(async () => {
  await app.close();
});

function post(body, headers = {}) {
  return fetch(`${app.base}/api/webhooks/flutterwave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

function verifHash(body, hash = HASH) {
  return { 'verif-hash': hash };
}

test('mock provider mode disables the flutterwave webhook surface', async () => {
  const res = await post(JSON.stringify({ type: 'charge.completed', data: {} }), verifHash(''));
  assert.equal(res.status, 503);
});

test('flutterwave adapter verifies both signature styles over the raw body', async () => {
  const { FlutterwaveProvider } = await import('../server/payments/flutterwave.js');
  const provider = new FlutterwaveProvider({
    baseUrl: 'https://unit.test/v3',
    secretKey: 'sk_unit',
    publicKey: 'pk_unit',
    entitySid: 'sid',
    webhookHash: HASH,
    timeoutMs: 2000,
  });
  const rawBody = Buffer.from(JSON.stringify({ event: 'charge.completed', data: { tx_ref: 'pap_x' } }));
  const headers = { 'verif-hash': HASH };
  const ok = provider.verifyWebhook(rawBody, headers);
  assert.equal(ok.ok, true);
  assert.equal(ok.event.reference, 'pap_x');
  assert.equal(ok.event.type, 'charge.completed');

  const forged = provider.verifyWebhook(rawBody, { 'verif-hash': 'wrong' });
  assert.equal(forged.ok, false);

  const hmac = crypto.createHmac('sha256', HASH).update(rawBody).digest('base64');
  const okHmac = provider.verifyWebhook(rawBody, { 'flutterwave-signature': hmac });
  assert.equal(okHmac.ok, true);

  const missing = provider.verifyWebhook(rawBody, {});
  assert.equal(missing.ok, false);
});

test('flutterwave adapter maps checkout, verify and transfer statuses', async () => {
  const { FlutterwaveProvider } = await import('../server/payments/flutterwave.js');
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    const respond = (payload) => ({ ok: true, status: 200, json: async () => payload });
    if (url.endsWith('/payments')) return respond({ status: 'success', data: { link: 'https://checkout.flw.com/pay/x' } });
    if (url.includes('/transactions/verify_by_reference'))
      return respond({ status: 'success', data: { id: 999, status: 'successful', amount: 500, currency: 'NGN', tx_ref: 'pap_ref1' } });
    if (url.endsWith('/transfers')) return respond({ status: 'success', data: { id: 555, status: 'PENDING' } });
    if (url.startsWith('https://unit.test/v3/transfers/')) return respond({ status: 'success', data: { id: 555, status: 'SUCCESSFUL' } });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const provider = new FlutterwaveProvider(
    { baseUrl: 'https://unit.test/v3', secretKey: 'sk_unit', publicKey: 'pk_unit', entitySid: 'sid', webhookHash: HASH, timeoutMs: 2000 },
    { fetchImpl: fakeFetch },
  );

  const init = await provider.initializePayment({
    reference: 'pap_ref1',
    amountKobo: 50000,
    currency: 'NGN',
    customerName: 'A',
    customerEmail: 'a@b.c',
    redirectUrl: 'https://app.test/ada',
    metadata: {},
  });
  assert.equal(init.checkoutUrl, 'https://checkout.flw.com/pay/x');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.amount, '500.00'); // exact integer conversion, no float drift
  assert.equal(body.tx_ref, 'pap_ref1');
  assert.equal(body.account_sid, 'sid');
  assert.equal(body.api_public_key, 'pk_unit');

  const verified = await provider.verifyPayment('pap_ref1');
  assert.equal(verified.status, 'success');
  assert.equal(verified.providerRef, '999');
  assert.equal(verified.amountKobo, 50000);

  const payout = await provider.initiatePayout({
    reference: 'wdl_1',
    amountKobo: 100000,
    currency: 'NGN',
    bankCode: '058',
    accountNumber: '0123456789',
    accountName: 'Ada',
    narration: 'n',
  });
  assert.equal(payout.status, 'processing');
  assert.equal(payout.providerRef, '555');

  const done = await provider.fetchPayout('555');
  assert.equal(done.status, 'paid');
});

test('webhook event log dedupes by provider event key', async () => {
  const { recordEvent, markEventProcessed } = await import('../server/domain/events.js');
  const first = recordEvent({ provider: 'flutterwave', eventKey: 'wbk:1', eventType: 'charge.completed', rawBody: Buffer.from('x') });
  assert.equal(first.inserted, true);
  const dupe = recordEvent({ provider: 'flutterwave', eventKey: 'wbk:1', eventType: 'charge.completed', rawBody: Buffer.from('x') });
  assert.equal(dupe.inserted, false);
  assert.equal(dupe.row.status, 'received');

  markEventProcessed(first.row.id);
  const dupeAfterProcessed = recordEvent({ provider: 'flutterwave', eventKey: 'wbk:1', eventType: 'charge.completed', rawBody: Buffer.from('x') });
  assert.equal(dupeAfterProcessed.inserted, false);
  assert.equal(dupeAfterProcessed.row.status, 'processed');

  // A failed event is allowed to be reprocessed on the next delivery.
  const second = recordEvent({ provider: 'flutterwave', eventKey: 'wbk:2', rawBody: Buffer.from('y') });
  markEventProcessed(second.row.id, 'boom');
  const retry = recordEvent({ provider: 'flutterwave', eventKey: 'wbk:2', rawBody: Buffer.from('y') });
  assert.equal(retry.inserted, false);
  assert.equal(retry.row.status, 'received'); // unlocked for reprocessing
});

test('kyc webhook surface is disabled in mock mode', async () => {
  const res = await fetch(`${app.base}/api/webhooks/sumsub`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 503);
});

test('no cookies are involved in webhook endpoints (CSRF-exempt by design)', async () => {
  const res = await post('{}', verifHash(''));
  assert.notEqual(res.status, 403); // signature check, not CSRF, governs webhooks
});

test('transfer webhook mapping: paid, failed, reversed drive the lifecycle', async () => {
  const { requestWithdrawal, sendWithdrawal, getWithdrawal, markWithdrawalPaid, markWithdrawalReversed, reverseReservedFunds } = await import(
    '../server/domain/withdrawals.js'
  );
  const { availableBalanceKobo } = await import('../server/domain/ledger.js');
  void getWithdrawal;

  const { activateCreator } = await import('./helpers.js');
  void activateCreator;
  const creatorRow = app.db.prepare('SELECT * FROM creators WHERE username = ?').get(creator.username);

  const init = await support(api, creator.username, { cups: 2, name: 'W', isAnonymous: false });
  await mockCharge(api, init.data.reference, 'success');
  const balanceAfterEarn = availableBalanceKobo(creatorRow.id);
  assert.ok(balanceAfterEarn > 0);

  const request = requestWithdrawal({ creator: creatorRow, amountKobo: 100000 });
  assert.ok(!request.error, JSON.stringify(request));
  const provider = (await import('../server/payments/index.js')).createPaymentProvider();
  const sent = await sendWithdrawal(request.withdrawal, provider);
  assert.equal(sent.outcome, 'processing');

  const reserved = availableBalanceKobo(creatorRow.id);
  assert.equal(reserved, balanceAfterEarn - 100000);

  // Bank pulls the transfer back: funds must return exactly once.
  const reversed = markWithdrawalReversed(request.withdrawal.id, '555');
  assert.equal(reversed.outcome, 'reversed');
  const again = markWithdrawalReversed(request.withdrawal.id, '555');
  assert.equal(again.outcome, 'already');
  assert.equal(availableBalanceKobo(creatorRow.id), balanceAfterEarn);
  void reverseReservedFunds;
  void markWithdrawalPaid;

  // Fresh withdrawal that ends paid: money leaves the ledger balance.
  const request2 = requestWithdrawal({ creator: creatorRow, amountKobo: 100000 });
  await sendWithdrawal(request2.withdrawal, provider);
  const paid = markWithdrawalPaid(request2.withdrawal.id, '777');
  assert.equal(paid.status, 'paid');
  // earned 100000, first withdrawal reversed back, second paid out: net 0.
  assert.equal(availableBalanceKobo(creatorRow.id), balanceAfterEarn - 100000);
});
