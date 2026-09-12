import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, formatKobo } from '../lib/api.js';

export default function MockCheckout() {
  const [params] = useSearchParams();
  const reference = params.get('reference') || '';
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/mock/paystack/pending?reference=${encodeURIComponent(reference)}`)
      .then(setInfo)
      .catch(() => setMissing(true));
  }, [reference]);

  async function charge(outcome) {
    setBusy(true);
    try {
      await api('/mock/paystack/charge', { method: 'POST', body: { reference, outcome } });
      navigate(`/${info.creator.username}?reference=${encodeURIComponent(reference)}`);
    } catch {
      setBusy(false);
      setMissing(true);
    }
  }

  if (missing) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-4xl">🤔</p>
        <h1 className="mt-4 text-lg font-bold">This checkout session isn't waiting anymore.</h1>
        <p className="mt-2 text-sm text-ink-soft">
          It was already paid, it failed, or live payments are enabled and mock checkout is off.
        </p>
        <Link to="/" className="btn btn-primary mt-6">
          Go home
        </Link>
      </div>
    );
  }

  if (!info) {
    return <div className="py-20 text-center text-ink-soft">Loading checkout…</div>;
  }

  return (
    <div className="mx-auto max-w-md pt-8">
      <div className="overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-ink/10">
        <div className="flex items-center justify-between bg-[#1a5ceb] px-5 py-3 text-white">
          <span className="text-sm font-semibold">Paystack</span>
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium">TEST MODE</span>
        </div>
        <div className="p-6 text-center">
          <p className="text-sm text-ink-soft">You are supporting</p>
          <p className="mt-1 text-xl font-bold">
            {info.creator.avatarEmoji} {info.creator.displayName}
          </p>
          <p className="mt-4 text-3xl font-extrabold">{formatKobo(info.amountKobo)}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {info.cups} cup{info.cups > 1 ? 's' : ''} of pap from {info.supporterName}
          </p>
          <div className="mt-6 space-y-3">
            <button className="btn btn-primary w-full" disabled={busy} onClick={() => charge('success')}>
              {busy ? 'Processing…' : `Pay ${formatKobo(info.amountKobo)}`}
            </button>
            <button className="btn btn-ghost w-full" disabled={busy} onClick={() => charge('failed')}>
              Cancel payment
            </button>
          </div>
          <p className="mt-4 text-xs text-ink-soft">
            This is a local mock of the Paystack checkout. With a real <span className="font-mono">PAYSTACK_SECRET_KEY</span>,
            this screen is replaced by Paystack's hosted page (card / transfer / USSD).
          </p>
        </div>
      </div>
    </div>
  );
}
