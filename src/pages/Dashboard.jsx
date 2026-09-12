import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatKobo, formatMoney, timeAgo } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const EMOJIS = ['🥣', '👩‍💻', '👨‍💻', '🎙️', '📷', '🎨', '✍️', '🧕', '👳', '⚽', '💃', '🦁'];

function Stat({ label, value }) {
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-1 text-2xl font-extrabold">{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const { creator, updateProfile, token } = useAuth();
  const [dash, setDash] = useState(null);
  const [form, setForm] = useState({
    displayName: creator.displayName,
    bio: creator.bio,
    avatarEmoji: creator.avatarEmoji,
    cupPrice: String(creator.cupPrice),
    goal: String(creator.goal),
  });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    api('/me/dashboard', { token: token() })
      .then(setDash)
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setSaved(false);
  };

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    const cupPrice = Number(form.cupPrice);
    const goal = Number(form.goal);
    if (!Number.isInteger(cupPrice) || cupPrice < 1 || cupPrice > 100000) {
      setError('Cup price must be a whole number between 1 and 100,000.');
      setBusy(false);
      return;
    }
    if (!Number.isInteger(goal) || goal < 0) {
      setError('Goal must be a whole number (0 hides it).');
      setBusy(false);
      return;
    }
    try {
      await updateProfile({
        displayName: form.displayName,
        bio: form.bio,
        avatarEmoji: form.avatarEmoji,
        cupPrice,
        goal,
      });
      setSaved(true);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/${creator.username}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed — select the link manually: ' + `${window.location.origin}/${creator.username}`);
    }
  }

  const stats = dash?.stats;

  return (
    <div className="pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          <span className="mr-2">{creator.avatarEmoji}</span>Creator dashboard
        </h1>
        <div className="flex items-center gap-2">
          <Link to={`/${creator.username}`} className="btn btn-ghost">
            View my page
          </Link>
          <button type="button" className="btn btn-ghost" onClick={copyLink}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Total raised" value={stats ? formatKobo(stats.earnedKobo) : '—'} />
        <Stat label="Last 30 days" value={stats ? formatKobo(stats.monthEarnedKobo) : '—'} />
        <Stat label="Cups of pap" value={stats ? stats.cups : '—'} />
        <Stat label="Supporters" value={stats ? stats.supportCount : '—'} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="font-semibold">Your page</h2>
          <form onSubmit={save} className="mt-4 space-y-4">
            {error && <div className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
            <div>
              <label className="label">Avatar</label>
              <div className="flex flex-wrap gap-1.5">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`Set avatar ${emoji}`}
                    onClick={() => {
                      setForm((f) => ({ ...f, avatarEmoji: emoji }));
                      setSaved(false);
                    }}
                    className={`h-10 w-10 rounded-xl text-xl transition ${
                      form.avatarEmoji === emoji ? 'bg-pap-dark/20 ring-2 ring-pap-dark' : 'hover:bg-ink/5'
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="displayName">Display name</label>
              <input id="displayName" className="input" required maxLength={40} value={form.displayName} onChange={set('displayName')} />
            </div>
            <div>
              <label className="label" htmlFor="bio">Bio (shown on your page)</label>
              <textarea id="bio" className="input resize-none" rows={3} maxLength={300} placeholder="What do you make, and why should people buy you a pap?" value={form.bio} onChange={set('bio')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="cupPrice">Cup price (₦)</label>
                <input id="cupPrice" className="input" type="number" min={1} max={100000} required value={form.cupPrice} onChange={set('cupPrice')} />
              </div>
              <div>
                <label className="label" htmlFor="goal">Monthly goal (₦, 0 to hide)</label>
                <input id="goal" className="input" type="number" min={0} step={1000} required value={form.goal} onChange={set('goal')} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
              {saved && <span className="text-sm font-medium text-accent">Saved ✓</span>}
            </div>
          </form>
        </section>

        <section className="card">
          <h2 className="font-semibold">Latest supporters</h2>
          {!stats ? (
            <p className="mt-3 text-sm text-ink-soft">Loading…</p>
          ) : stats.supportCount === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              Nobody yet. Share your page link everywhere — the wall fills fast once you do.
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {dash.recent.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm">
                      <b>{s.name}</b>
                      {s.isAnonymous && <span className="ml-1.5 rounded-full bg-ink/5 px-2 py-0.5 text-xs text-ink-soft">anonymous</span>}
                      <span className="text-ink-soft"> · {s.cups} cup{s.cups > 1 ? 's' : ''} · {timeAgo(s.paidAt)}</span>
                    </p>
                    {s.message && <p className="mt-1 whitespace-pre-wrap rounded-xl bg-paper px-3.5 py-2.5 text-sm">{s.message}</p>}
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-accent">+{formatKobo(s.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
