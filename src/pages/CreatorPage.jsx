import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, formatKobo, formatMoney, timeAgo } from '../lib/api.js';

const PRESETS = [1, 2, 3, 5, 10];

export default function CreatorPage() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const reference = params.get('reference');

  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [payResult, setPayResult] = useState(null);
  const [mode, setMode] = useState(null);

  const [cups, setCups] = useState(1);
  const [form, setForm] = useState({ name: '', message: '', email: '', isAnonymous: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api(`/pages/${username}`)
      .then(setData)
      .catch((err) => {
        if (err.status === 404) setNotFound(true);
      });
  }, [username]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api('/config')
      .then((c) => setMode(c.paymentsMode))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!reference) return;
    api(`/supports/${reference}/verify`)
      .then((res) => {
        setPayResult(res.status);
        if (res.status === 'success') load();
      })
      .catch(() => setPayResult('unknown'));
  }, [reference, load]);

  function setField(key) {
    return (e) => {
      const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      setForm((f) => ({ ...f, [key]: value }));
    };
  }

  function clampCups(value) {
    const n = Number.parseInt(value, 10);
    if (Number.isNaN(n)) return 1;
    return Math.min(100, Math.max(1, n));
  }

  async function support(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api(`/pages/${username}/supports`, {
        method: 'POST',
        body: { cups, ...form },
      });
      if (res.authorizationUrl.startsWith('/')) {
        navigate(res.authorizationUrl);
      } else {
        window.location.assign(res.authorizationUrl);
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <div className="py-20 text-center">
        <p className="text-5xl">🥣</p>
        <h1 className="mt-4 text-xl font-bold">No creator found at this address.</h1>
        <Link to="/" className="btn btn-primary mt-6">
          Go home
        </Link>
      </div>
    );
  }

  if (!data) {
    return <div className="py-20 text-center text-ink-soft">Loading…</div>;
  }

  const { creator, supporters, stats } = data;
  const total = creator.cupPrice * cups;
  const goalPct =
    creator.goal > 0 ? Math.min(100, Math.round(((stats.earnedKobo / 100 / creator.goal) * 100))) : null;
  const firstName = creator.displayName.split(' ')[0];

  return (
    <div className="pt-4">
      {payResult === 'success' && (
        <div className="mb-6 rounded-2xl bg-accent/10 px-5 py-4 font-medium text-accent ring-1 ring-accent/20">
          🎉 Payment confirmed — your cups are on the wall. {firstName} says go and thank you!
        </div>
      )}
      {payResult === 'pending' && (
        <div className="mb-6 rounded-2xl bg-pap/15 px-5 py-4 text-sm ring-1 ring-pap/30">
          Your payment is still pending. If you completed it, it will show up on the wall any second.
        </div>
      )}
      {payResult === 'failed' && (
        <div className="mb-6 rounded-2xl bg-danger/10 px-5 py-4 text-sm text-danger ring-1 ring-danger/20">
          That payment didn't go through. No charge was made — try again below.
        </div>
      )}
      {mode === 'mock' && (
        <p className="mb-6 rounded-xl bg-ink/5 px-4 py-2 text-xs text-ink-soft">
          Test mode — no real money moves. Set <span className="font-mono">PAYSTACK_SECRET_KEY</span> to take live payments.
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="card">
            <div className="flex items-center gap-4">
              <span className="text-6xl">{creator.avatarEmoji}</span>
              <div>
                <h1 className="text-2xl font-bold leading-tight">{creator.displayName}</h1>
                <p className="text-sm text-ink-soft">@{creator.username}</p>
              </div>
            </div>
            {creator.bio && <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{creator.bio}</p>}
            <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-sm text-ink-soft">
              <span>
                <b className="text-ink">{formatKobo(stats.earnedKobo)}</b> raised
              </span>
              <span>
                <b className="text-ink">{stats.cups}</b> cups of pap
              </span>
              <span>
                <b className="text-ink">{stats.supportCount}</b> supporters
              </span>
            </div>
            {goalPct !== null && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-ink-soft">
                  <span>
                    Support goal · {formatMoney(creator.goal)}
                  </span>
                  <span>{goalPct}%</span>
                </div>
                <div className="mt-1.5 h-2.5 rounded-full bg-ink/10">
                  <div className="h-2.5 rounded-full bg-pap-dark" style={{ width: `${goalPct}%` }} />
                </div>
              </div>
            )}
          </section>

          <section className="card">
            <h2 className="font-semibold">Wall of love</h2>
            {supporters.length === 0 ? (
              <p className="mt-3 text-sm text-ink-soft">No cups poured yet — be the first to buy {firstName} a pap.</p>
            ) : (
              <ul className="mt-4 space-y-5">
                {supporters.map((s) => (
                  <li key={s.id} className="flex gap-3">
                    <span className="text-2xl">🥣</span>
                    <div className="min-w-0">
                      <p className="text-sm">
                        <b>{s.name || 'Someone'}</b> bought {s.cups} cup{s.cups > 1 ? 's' : ''} of pap
                        <span className="text-ink-soft"> · {timeAgo(s.paidAt)}</span>
                      </p>
                      {s.message && (
                        <p className="mt-1.5 whitespace-pre-wrap rounded-xl bg-paper px-3.5 py-2.5 text-sm">{s.message}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="card lg:sticky lg:top-6">
          <h2 className="font-semibold">Buy {firstName} a pap</h2>
          <p className="mt-1 text-xs text-ink-soft">
            {formatMoney(creator.cupPrice)} per cup · card, transfer or USSD via Paystack
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setCups(p)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                  cups === p ? 'bg-pap-dark text-white' : 'bg-ink/5 hover:bg-ink/10'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              aria-label="One less cup"
              className="btn btn-ghost h-10 w-10 rounded-full p-0 text-lg"
              onClick={() => setCups((c) => Math.max(1, c - 1))}
            >
              −
            </button>
            <input
              aria-label="Number of cups"
              className="input w-16 text-center"
              type="number"
              min={1}
              max={100}
              value={cups}
              onChange={(e) => setCups(clampCups(e.target.value))}
            />
            <button
              type="button"
              aria-label="One more cup"
              className="btn btn-ghost h-10 w-10 rounded-full p-0 text-lg"
              onClick={() => setCups((c) => Math.min(100, c + 1))}
            >
              +
            </button>
            <span className="ml-auto text-lg font-bold">{formatMoney(total)}</span>
          </div>

          <form onSubmit={support} className="mt-5 space-y-3">
            <input
              className="input"
              placeholder="Your name"
              required
              maxLength={30}
              value={form.name}
              onChange={setField('name')}
            />
            <textarea
              className="input resize-none"
              rows={3}
              placeholder="Say something nice (optional)"
              maxLength={500}
              value={form.message}
              onChange={setField('message')}
            />
            <input
              className="input"
              type="email"
              placeholder="Email for your receipt (optional)"
              maxLength={254}
              value={form.email}
              onChange={setField('email')}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isAnonymous} onChange={setField('isAnonymous')} />
              Hide my name on the wall
            </label>
            {error && <p className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{error}</p>}
            <button className="btn btn-primary w-full" disabled={busy || !form.name.trim()}>
              {busy ? 'Redirecting…' : `Pay ${formatMoney(total)}`}
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}
