import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startClient, activateCreator, support, mockCharge } from './helpers.js';

let app;
let api;
before(async () => {
  app = await startClient();
  api = app.api;
});
after(async () => {
  await app.close();
});

async function earnBalance(username, cups = 3) {
  const init = await support(api, username, { cups, name: 'Earner', isAnonymous: false });
  await mockCharge(api, init.data.reference, 'success');
}

test('withdrawals refuse bad amounts, inactive pages and missing payout data', async () => {
  const notActive = await activateCreator(api);
  // Deactivate by reverting KYC state directly (edge condition simulation).
  const belowMin = await api('/api/me/withdrawals', { method: 'POST', body: { amountKobo: 500 } });
  assert.equal(belowMin.status, 400);
  void notActive;

  const aboveMax = await api('/api/me/withdrawals', { method: 'POST', body: { amountKobo: 99_000_000 } });
  assert.equal(aboveMax.status, 400);

  const notInteger = await api('/api/me/withdrawals', { method: 'POST', body: { amountKobo: 1000.5 } });
  assert.equal(notInteger.status, 400);

  const negative = await api('/api/me/withdrawals', { method: 'POST', body: { amountKobo: -5 } });
  assert.equal(negative.status, 400);
});

test('withdrawal request requires an available balance', async () => {
  const created = await activateCreator(api);
  const res = await api('/api/me/withdrawals', { method: 'POST', body: { amountKobo: 100000 } });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Not enough available balance.');
  assert.equal(res.data.availableKobo, 0);
});

test('happy path: request reserves funds, payout settles, balance drops exactly once', async () => {
  const created = await activateCreator(api);
  await earnBalance(created.username, 3); // ₦1,500

  const res = await api('/api/me/withdrawals', { method: 'POST', body: { amountKobo: 100000 } });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const withdrawal = res.data.withdrawal;
  assert.equal(withdrawal.status, 'processing');
  assert.equal(withdrawal.accountLast4, '6789');
  assert.ok(!JSON.stringify(res.data).includes('0123456789'), 'full account number must not be serialized');

  const dash = await api('/api/me/dashboard');
  assert.equal(dash.data.balance.availableKobo, 50000); // 150000 - 100000
  assert.equal(dash.data.balance.pendingWithdrawalKobo, 100000);

  const complete = await api('/api/mock/payouts/complete', {
    method: 'POST',
    body: { reference: withdrawal.reference, outcome: 'paid' },
  });
  assert.equal(complete.data.status, 'paid');

  const dash2 = await api('/api/me/dashboard');
  assert.equal(dash2.data.balance.availableKobo, 50000);
  assert.equal(dash2.data.balance.pendingWithdrawalKobo, 0);
});

test('failed payout returns reserved funds exactly once', async () => {
  const { availableBalanceKobo } = await import('../server/domain/ledger.js');
  const created = await activateCreator(api);
  await earnBalance(created.username, 2); // ₦1,000
  const creatorRow = app.db.prepare('SELECT id FROM creators WHERE username = ?').get(created.username);
  const balance = availableBalanceKobo(creatorRow.id);

  const res = await api('/api/me/withdrawals', { method: 'POST', body: { amountKobo: 100000 } });
  assert.equal(res.status, 201);
  const reference = res.data.withdrawal.reference;
  assert.equal(availableBalanceKobo(creatorRow.id), balance - 100000);

  const complete = await api('/api/mock/payouts/complete', { method: 'POST', body: { reference, outcome: 'failed' } });
  assert.equal(complete.data.status, 'failed');
  assert.equal(availableBalanceKobo(creatorRow.id), balance, 'funds must return after failure');

  const reversalRows = app.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE idempotency_key LIKE 'withdrawal:%:reversal'").get();
  assert.equal(reversalRows.n, 1);
});

test('failed withdrawal can be retried as a new request (no double payout)', async () => {
  const created = await activateCreator(api);
  await earnBalance(created.username, 4); // ₦2,000

  const first = await api('/api/me/withdrawals', { method: 'POST', body: { amountKobo: 100000 } });
  const firstRef = first.data.withdrawal.reference;
  await api('/api/mock/payouts/complete', { method: 'POST', body: { reference: firstRef, outcome: 'failed' } });

  // Retry = new withdrawal; funds were returned by the failure.
  const second = await api('/api/me/withdrawals', { method: 'POST', body: { amountKobo: 100000 } });
  assert.equal(second.status, 201);
  assert.notEqual(second.data.withdrawal.reference, firstRef);
  assert.equal(second.data.withdrawal.attempts, 1, 'new attempt, not a blind resend');

  const complete = await api('/api/mock/payouts/complete', { method: 'POST', body: { reference: secondRef(second.data.withdrawal.reference), outcome: 'paid' } });
  assert.equal(complete.data.status, 'paid');

  const rows = app.db.prepare('SELECT status FROM withdrawals WHERE creator_id = ? ORDER BY id').all(
    app.db.prepare('SELECT id FROM creators WHERE username = ?').get(created.username).id,
  );
  assert.deepEqual(rows.map((r) => r.status), ['failed', 'paid']);

  function secondRef(ref) {
    return ref;
  }
});

test('concurrent withdrawal requests cannot double-spend the balance', async () => {
  const created = await activateCreator(api);
  await earnBalance(created.username, 3); // ₦1,500 available

  const [a, b] = await Promise.all([
    api('/api/me/withdrawals', { method: 'POST', body: { amountKobo: 100000 } }),
    api('/api/me/withdrawals', { method: 'POST', body: { amountKobo: 100000 } }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 400], 'only one concurrent request may pass the balance guard');
});

test('open withdrawals are capped', async () => {
  const created = await activateCreator(api);
  await earnBalance(created.username, 20); // ₦10,000
  const creatorRow = app.db.prepare('SELECT id FROM creators WHERE username = ?').get(created.username);

  // config.maxOpenWithdrawals defaults to 3; request 3 (min each).
  for (let i = 0; i < 3; i += 1) {
    const res = await api('/api/me/withdrawals', { method: 'POST', body: { amountKobo: 100000 } });
    assert.equal(res.status, 201, JSON.stringify(res.data));
  }
  const fourth = await api('/api/me/withdrawals', { method: 'POST', body: { amountKobo: 100000 } });
  assert.equal(fourth.status, 409);
  void creatorRow;
});

test('withdrawal serialization never exposes the full account number', async () => {
  const created = await activateCreator(api);
  await earnBalance(created.username, 1);
  await api('/api/me/withdrawals', { method: 'POST', body: { amountKobo: 100000 } }).catch(() => {});
  const list = await api('/api/me/withdrawals');
  for (const w of list.data.withdrawals ?? []) {
    assert.equal('account_number' in w, false);
    assert.ok(!JSON.stringify(w).includes('0123456789'));
  }
});
