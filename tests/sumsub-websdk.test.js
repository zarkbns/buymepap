import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The browser-only boundary around Sumsub's WebSDK, driven against a stub head:
 * which script gets injected, what the widget is initialised with, and when the
 * call settles. This is the layer that silently no-oped in production once.
 *
 * The loader memoises its in-flight load in module state, so each test imports a
 * fresh instance instead of depending on execution order.
 */
let injected;
let instance = 0;

beforeEach(() => {
  injected = [];
  globalThis.window = {};
  globalThis.document = {
    createElement: () => ({ src: '', async: false, remove() {} }),
    head: { append: (el) => injected.push(el) },
  };
});

const freshLoader = async () => (await import(`../src/lib/sumsub.js?test=${++instance}`)).runVerification;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const session = {
  token: 'short_lived_jwt',
  userId: 'pap_7_deadbeef',
  scriptUrl: 'https://cdn.sumsub.com/websdk/sumsub.websdk.2.0.0.js',
};

test('webSDK 2.x is injected on demand, initialised with the server-minted session, and settles on close', async () => {
  const runVerification = await freshLoader();
  let settled = false;
  const running = runVerification(session).then(() => {
    settled = true;
  });
  await tick();

  assert.deepEqual(
    injected.map((el) => el.src),
    [session.scriptUrl],
  );
  assert.ok(injected[0].async, 'the widget script must not block the page');

  let config;
  globalThis.window.SumsubWebsdk = {
    initializeWebsdk: (cfg) => {
      config = cfg;
      return Promise.resolve();
    },
  };
  injected[0].onload();
  await tick();

  assert.equal(config.sessionConfig.token, 'short_lived_jwt');
  assert.equal(config.sessionConfig.userId, 'pap_7_deadbeef');
  assert.equal(typeof config.callbacks.onSessionSuccess, 'function');

  config.callbacks.onClose();
  await running;
  assert.equal(settled, true);
});

test('webSDK 1.x callable shape is supported and an already-loaded script is not re-injected', async () => {
  const runVerification = await freshLoader();
  let args;
  globalThis.window.SumsubWebsdk = (name, opts) => {
    args = { name, opts };
  };

  const running = runVerification(session);
  await tick();
  assert.equal(injected.length, 0); // nothing fetched: the global is already there

  args.opts.onSessionPending();
  await running;
  assert.equal(args.name, 'client');
  assert.equal(args.opts.token, 'short_lived_jwt');
});

test('a widget that cannot load rejects with a client-safe message and can be retried', async () => {
  const runVerification = await freshLoader();
  const running = runVerification(session);
  await tick();
  assert.equal(injected.length, 1);
  injected[0].onerror();

  await assert.rejects(running, (err) => {
    assert.match(err.message, /verification provider/i);
    assert.doesNotMatch(err.message, /sumsub|cdn|https|\bjs\b/i); // no provider, host or path detail leaks
    return true;
  });

  // The failed load must not poison a later attempt.
  const retry = runVerification(session);
  await tick();
  assert.equal(injected.length, 2);
});
