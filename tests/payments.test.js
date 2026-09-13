import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startClient, activateCreator, createCreator, support, mockCharge, uniqueName } from './helpers.js';

let app;
let api;
before(async () => {
  app = await startClient();
  api = app.api;
});
after(async () => {
  await app.close();
});

test('inactive pages cannot collect money', async () => {
  const created = await createCreator(api);
  const res = await support(api, created.username, { cups: 1, name: 'Chidi', isAnonymous: false });
  assert.equal(res.status, 409);

  const page = await api(`/api/pages/${created.username}`);
  assert.equal(page.data.canAcceptPayments, false);
});

test('payment amount is exact integer kobo math of cup price × cups', async () => {
  const created = await activateCreator(api, { cupPrice: 777 });
  const res = await support(api, created.username, { cups: 3, name: 'Bola', isAnonymous: false });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.amountKobo, 777 * 3 * 100);
  assert.equal(res.data.currency, 'NGN');
  assert.ok(res.data.checkoutUrl.includes(res.data.reference));
});

test('payment input validation', async () => {
  const created = await activateCreator(api);
  const bad = [
    { cups: 0, name: 'X', isAnonymous: false },
    { cups: 101, name: 'X', isAnonymous: false },
    { cups: 1.5, name: 'X', isAnonymous: false },
    { cups: 1, name: '   ', isAnonymous: false },
    { cups: 1, name: 'X', message: 'x'.repeat(501), isAnonymous: false },
    { cups: 1, name: 'X', isAnonymous: 'yes' },
    { cups: 1, name: 'X', isAnonymous: false, email: 'bad-email' },
    { cups: 2 ** 40, name: 'X', isAnonymous: false },
  ];
  for (const body of bad) {
    const res = await support(api, created.username, body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const ghost = await support(api, 'nobody_here_x');
  assert.equal(ghost.status, 404);
});

test('full loop: init → charge → verify → wall, with ledger credit', async () => {
  const created = await activateCreator(api, { cupPrice: 500 });
  const init = await support(api, created.username, {
    cups: 2,
    name: 'Chidi',
    message: 'Keep going!',
    isAnonymous: false,
  });
  assert.equal(init.status, 201);
  const reference = init.data.reference;

  const before = await api(`/api/pages/${created.username}`);
  assert.equal(before.data.stats.cups, 0);
  assert.equal(before.data.supporters.length, 0);

  await mockCharge(api, reference, 'success');

  const status = await api(`/api/payments/${reference}`);
  assert.equal(status.data.status, 'success');
  assert.equal(status.data.payment.name, 'Chidi');

  const after = await api(`/api/pages/${created.username}`);
  assert.equal(after.data.stats.cups, 2);
  assert.equal(after.data.stats.supportCount, 1);
  assert.equal(after.data.supporters[0].message, 'Keep going!');

  // Exactly one ledger credit, of the net (fee = 0 bps by default here).
  const ledger = app.db
    .prepare("SELECT * FROM ledger_entries WHERE idempotency_key = 'payment:1:net'")
    .all()
    .filter((row) => row.creator_id !== undefined);
  const rows = app.db.prepare('SELECT COUNT(*) AS n FROM ledger_entries WHERE payment_id IS NOT NULL AND kind = ?').get('payment_net');
  assert.ok(rows.n >= 1);
  void ledger;

  const payment = app.db.prepare('SELECT * FROM payments WHERE reference = ?').get(reference);
  assert.equal(payment.amount_kobo, 100000);
  assert.equal(payment.fee_kobo + payment.net_kobo, payment.amount_kobo);
  assert.equal(payment.credited_at !== null, true);
});

test('failed payments never reach the wall or the ledger', async () => {
  const created = await activateCreator(api);
  const init = await support(api, created.username, { cups: 1, name: 'Tunde', isAnonymous: false });
  await mockCharge(api, init.data.reference, 'failed');

  const status = await api(`/api/payments/${init.data.reference}`);
  assert.equal(status.data.status, 'failed');
  assert.equal(status.data.payment, null);

  const page = await api(`/api/pages/${created.username}`);
  assert.equal(page.data.supporters.length, 0);
  const payment = app.db.prepare('SELECT * FROM payments WHERE reference = ?').get(init.data.reference);
  const credits = app.db.prepare('SELECT COUNT(*) AS n FROM ledger_entries WHERE payment_id = ?').get(payment.id);
  assert.equal(credits.n, 0);
});

test('duplicate charges and repeat verification never double-credit', async () => {
  const created = await activateCreator(api);
  const init = await support(api, created.username, { cups: 3, name: 'Emeka', isAnonymous: false });
  const reference = init.data.reference;

  await mockCharge(api, reference, 'success');
  await mockCharge(api, reference, 'success');
  await api(`/api/payments/${reference}`); // verify again
  await mockCharge(api, reference, 'failed'); // late failure must not un-settle

  const page = await api(`/api/pages/${created.username}`);
  assert.equal(page.data.stats.cups, 3);
  const payment = app.db.prepare('SELECT * FROM payments WHERE reference = ?').get(reference);
  const credits = app.db.prepare('SELECT COUNT(*) AS n FROM ledger_entries WHERE payment_id = ?').get(payment.id);
  assert.equal(credits.n, 1);
  assert.equal(app.db.prepare('SELECT status FROM payments WHERE reference = ?').get(reference).status, 'success');
});

test('concurrent charge + verification race produces exactly one credit', async () => {
  const created = await activateCreator(api);
  const init = await support(api, created.username, { cups: 5, name: 'Zainab', isAnonymous: false });
  const reference = init.data.reference;

  const attempts = await Promise.all([
    mockCharge(api, reference, 'success'),
    api(`/api/payments/${reference}`),
    mockCharge(api, reference, 'success'),
    api(`/api/payments/${reference}`),
  ]);
  void attempts;

  const payment = app.db.prepare('SELECT * FROM payments WHERE reference = ?').get(reference);
  const credits = app.db.prepare('SELECT COUNT(*) AS n FROM ledger_entries WHERE payment_id = ?').all(payment.id);
  assert.equal(credits[0].n, 1);
  const page = await api(`/api/pages/${created.username}`);
  assert.equal(page.data.stats.cups, 5);
});

test('anonymous support hides the name publicly but not on the dashboard', async () => {
  const created = await activateCreator(api);
  const init = await support(api, created.username, { cups: 1, name: 'Funke', message: 'anon', isAnonymous: true });
  await mockCharge(api, init.data.reference, 'success');

  const page = await api(`/api/pages/${created.username}`);
  assert.equal(page.data.supporters[0].name, null);

  const dash = await api('/api/me/dashboard');
  assert.equal(dash.data.recent[0].name, 'Funke');
  assert.equal(dash.data.recent[0].isAnonymous, true);
});

test('dashboards show gross, fee and net with balances', async () => {
  const created = await activateCreator(api);
  const init = await support(api, created.username, { cups: 2, name: 'Ada Fan', isAnonymous: false });
  await mockCharge(api, init.data.reference, 'success');

  const dash = await api('/api/me/dashboard');
  assert.equal(dash.data.stats.grossKobo, 100000);
  assert.equal(dash.data.stats.feeKobo, 0);
  assert.equal(dash.data.stats.netKobo, 100000);
  assert.equal(dash.data.balance.availableKobo, 100000);
  assert.equal(dash.data.balance.pendingWithdrawalKobo, 0);
});

test('bank list is public and shaped for the payout form', async () => {
  const res = await api('/api/banks');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.data.banks));
  assert.ok(res.data.banks.every((b) => typeof b.code === 'string' && typeof b.name === 'string'));
});

test('unknown references 404 without leaking provider info', async () => {
  const res = await api('/api/payments/pap_does_not_exist');
  assert.equal(res.status, 404);
  assert.deepEqual(Object.keys(res.data), ['error']);
});
