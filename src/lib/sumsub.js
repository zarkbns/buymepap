/**
 * Sumsub WebSDK loader.
 *
 * The third-party script is injected only when a creator explicitly starts
 * identity verification — nothing is fetched from Sumsub before that click, and
 * nothing at all is fetched in mock mode. The session token is short-lived and
 * minted server-side; this module never sees a provider secret.
 *
 * Both shipped WebSDK shapes are handled: 2.x exposes
 * `initializeWebsdk(config)`, 1.x is callable as `SumsubWebsdk('client', opts)`.
 */
let pendingLoad;

function loadScript(src) {
  if (window.SumsubWebsdk) return Promise.resolve(window.SumsubWebsdk);
  pendingLoad ??= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve(window.SumsubWebsdk);
    el.onerror = () => {
      pendingLoad = undefined;
      el.remove();
      reject(new Error('Could not reach the verification provider. Try again in a moment.'));
    };
    document.head.append(el);
  });
  return pendingLoad;
}

function describeError(detail) {
  const text = detail?.description ?? detail?.message ?? (typeof detail === 'string' ? detail : '');
  return text ? `Verification stopped: ${text}` : 'Verification stopped unexpectedly. You can try again.';
}

/**
 * Opens the verification widget and settles once it reports a terminal event
 * (decision submitted, still in review, or closed). The caller then re-reads
 * the state from our server, which asks Sumsub — the widget's word is never
 * trusted.
 */
export async function runVerification(session) {
  const sdk = await loadScript(session.scriptUrl);
  return new Promise((resolve, reject) => {
    if (typeof sdk !== 'function' && typeof sdk?.initializeWebsdk !== 'function') {
      reject(new Error('The verification widget could not start. Try again in a moment.'));
      return;
    }
    const settled = new Set();
    const finish = () => {
      if (settled.has('finish')) return;
      settled.add('finish');
      resolve();
    };
    const fail = (detail) => {
      if (settled.has('fail')) return;
      settled.add('fail');
      reject(new Error(describeError(detail)));
    };
    const callbacks = {
      onSessionSuccess: finish,
      onSessionPending: finish,
      onSessionExpired: finish,
      onClose: finish,
      onInternalError: fail,
      onError: fail,
    };

    if (typeof sdk.initializeWebsdk === 'function') {
      Promise.resolve(
        sdk.initializeWebsdk({
          clientParams: { theme: 'system' },
          sessionConfig: {
            userId: session.userId,
            token: session.token,
            fullScreenOnMobile: true,
            reloadOnClose: false,
          },
          callbacks,
        }),
      ).catch((err) => fail(err?.message ?? err));
    } else {
      sdk('client', { userId: session.userId, token: session.token, ...callbacks });
    }
  });
}
