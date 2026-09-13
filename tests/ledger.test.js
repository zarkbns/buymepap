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

test('platform fee snapshots: gross = fee + net, ledger stores net', async () => {
  // Re-run the flow under a 10% fee by editing the config snapshot already
  // loaded in this process? Config is immutable per process, so instead assert
  // the invariant on the default (0%) path and exercise 10% via domain math.
  const created = await activateCreator(api);
  const init = await support(api, created.username, { cups: 2, name: 'Fee', isAnonymous: false });
  await mockCharge(api, init.data.reference, 'success');

  const payment = app.db.prepare('SELECT * FROM payments WHERE reference = ?').get(init.data.reference);
  assert.equal(payment.fee_bps, 0);
  assert.equal(payment.amount_kobo, 100000);
  assert.equal(payment.fee_kobo, 0);
  assert.equal(payment.net_kobo, 100000);
});

test('fee arithmetic is exact integer math with floor rounding', async () => {
  const { splitAmount, feeKobo, koboToMajorString, majorToKobo, formatKobo } = await import('../server/money.js');

  assert.deepEqual(splitAmount(100000, 500), { gross: 100000, fee: 5000, net: 95000 });
  assert.deepEqual(splitAmount(9999, 700), { gross: 9999, fee: 699, net: 9300 }); // floor, gross = fee + net
  assert.equal(feeKobo(12345, 333), 411); // 12345*333/10000 = 411.0885 -> 411

  assert.equal(koboToMajorString(500), '5.00');
  assert.equal(koboToMajorString(123456789), '1234567.89');
  assert.equal(majorToKobo('500'), 50000);
  assert.equal(majorToKobo('500.5'), 50050);
  assert.equal(majorToKobo(500.25), 50025);
  assert.throws(() => majorToKobo('0.005')); // finer than kobo is refused
  assert.throws(() => majorToKobo('abc'));
  assert.throws(() => assertKoboNegative(feeKobo));
  assert.equal(formatKobo(123456), '₦1,234.56');
  assert.equal(formatKobo(50000), '₦500');

  function assertKoboNegative(fn) {
    return fn(-1, 500);
  }
});

test('non-zero platform fee credits net only, with the exact snapshot', async () => {
  const { createPendingPayment, settlePayment, getPaymentByReference } = await import('../server/domain/payments.js');
  const { availableBalanceKobo } = await import('../server/domain/ledger.js');

  const created = await activateCreator(api);
  const creatorRow = app.db.prepare('SELECT * FROM creators WHERE id = ?').get(
    app.db.prepare('SELECT id FROM creators WHERE username = ?').get(created.username).id,
  );

  const before = availableBalanceKobo(creatorRow.id);
  const reference = `pap_fee_${Date.now().toString(36)}`;
  createPendingPayment({
    creatorId: creatorRow.id,
    cups: 1,
    supporterName: 'FeePayer',
    message: '',
    isAnonymous: false,
    amountKobo: 10000,
    currency: 'NGN',
    reference,
    provider: 'mock',
    feeBasisPoints: 1250, // 12.5%
  });
  const settled = settlePayment(reference, { providerRef: 'unit_1' });
  assert.equal(settled.outcome, 'settled');

  const payment = getPaymentByReference(reference);
  assert.equal(payment.amount_kobo, 10000);
  assert.equal(payment.fee_kobo, 1250);
  assert.equal(payment.net_kobo, 8750);
  assert.equal(availableBalanceKobo(creatorRow.id), before + 8750);

  const ledger = app.db
    .prepare("SELECT * FROM ledger_entries WHERE idempotency_key = 'payment:' || ? || ':net'")
    .get(String(payment.id));
  assert.equal(ledger.amount_kobo, 8750);
});

test('provider amount mismatch blocks crediting and is flagged', async () => {
  const { applyProviderConfirmation, getPaymentByReference } = await import('../server/domain/payments.js');
  const { availableBalanceKobo } = await import('../server/domain/ledger.js');

  const created = await activateCreator(api);
  const creatorRow = app.db.prepare('SELECT id FROM creators WHERE username = ?').get(created.username);
  const before = availableBalanceKobo(creatorRow.id);

  const init = await support(api, created.username, { cups: 1, name: 'Mallory', isAnonymous: false });
  const reference = init.data.reference;

  const result = applyProviderConfirmation(reference, {
    status: 'success',
    amountKobo: 1, // provider reports a different amount
    currency: 'NGN',
    providerRef: 'flw_1',
    via: 'webhook',
  });
  assert.equal(result.outcome, 'amount_mismatch');

  const payment = getPaymentByReference(reference);
  assert.equal(payment.reconcile_status, 'amount_mismatch');
  assert.equal(payment.status, 'pending');
  assert.equal(availableBalanceKobo(creatorRow.id), before);

  // The correct amount from a later verification still settles exactly once.
  const ok = applyProviderConfirmation(reference, { status: 'success', amountKobo: 50000, currency: 'NGN', providerRef: 'flw_2' });
  assert.equal(ok.outcome, 'settled');
  assert.equal(availableBalanceKobo(creatorRow.id), before + 50000);
});

test('ledger is the single source of truth for balances', async () => {
  const { availableBalanceKobo } = await import('../server/domain/ledger.js');
  const created = await activateCreator(api);
  const creatorRow = app.db.prepare('SELECT id FROM creators WHERE username = ?').get(created.username);

  const init = await support(api, created.username, { cups: 3, name: 'Ledger', isAnonymous: false });
  await mockCharge(api, init.data.reference, 'success');

  const fromLedger = availableBalanceKobo(creatorRow.id);
  const computed = app.db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_kobo ELSE -amount_kobo END), 0) AS bal
       FROM ledger_entries WHERE creator_id = ?`,
    )
    .get(creatorRow.id).bal;
  assert.equal(fromLedger, Number(computed));
  assert.ok(fromLedger > 0);
});
