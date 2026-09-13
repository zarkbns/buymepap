import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatKobo, timeAgo } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const EMOJIS = ['🥣', '👩‍💻', '👨‍💻', '🎙️', '📷', '🎨', '✍️', '🧕', '⚽', '💃', '🦁', '🥁'];

function Stat({ label, value }) {
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-1 text-2xl font-extrabold">{value}</p>
    </div>
  );
}

function Checklist({ activation, creator, onKyc, onPayout, onActivate, busy }) {
  if (!activation) return null;
  const items = [
    { done: activation.phoneVerified, label: 'Phone verified' },
    {
      done: activation.kycStatus === 'approved',
      label:
        activation.kycStatus === 'approved'
          ? 'Identity verified'
          : activation.kycStatus === 'pending'
            ? 'Identity verification in review'
            : activation.kycStatus === 'rejected'
              ? `Identity verification rejected${creator.kycRejectReason ? ` — ${creator.kycRejectReason}` : ''}`
              : 'Verify your identity',
      action: activation.kycStatus !== 'approved' ? { label: 'Start', onClick: onKyc } : null,
    },
    {
      done: activation.payoutConfigured,
      label: creator.payoutConfigured ? `Payout: ${creator.bankName || ''} ••${creator.bankAccountLast4 ?? ''}` : 'Add your payout account',
    },
    {
      done: activation.paymentsActive,
      label: activation.paymentsActive ? 'Payments active' : 'Activate payments',
      action:
        !activation.paymentsActive && activation.phoneVerified && activation.kycStatus === 'approved' && activation.payoutConfigured
          ? { label: 'Activate', onClick: onActivate }
          : null,
    },
  ];

  return (
    <section className="card">
      <h2 className="font-semibold">Payment setup</h2>
      <ul className="mt-3 space-y-2.5">
        {items.map((item) => (
          <li key={item.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  item.done ? 'bg-accent/15 text-accent ring-1 ring-accent/30' : 'bg-ink/5 text-ink-soft ring-1 ring-ink/10'
                }`}
              >
                {item.done ? '✓' : ''}
              </span>
              <span className={item.done ? 'text-ink-soft line-through decoration-ink-soft/40' : ''}>{item.label}</span>
            </span>
            {item.action && (
              <button type="button" className="btn btn-ghost h-8 min-h-8 px-3 text-xs" disabled={busy} onClick={item.action.onClick}>
                {item.action.label}
              </button>
            )}
          </li>
        ))}
      </ul>
      {!activation.paymentsActive && (
        <p className="mt-3 text-xs text-ink-soft">
          Your page is live for the world to see, but it only collects money once all four steps are green.
        </p>
      )}
    </section>
  );
}

function PayoutForm({ onSaved }) {
  const [banks, setBanks] = useState([]);
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/banks').then((d) => setBanks(d.banks ?? [])).catch(() => {});
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/me/payout-account', { method: 'PUT', body: { bankCode, accountNumber } });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card space-y-4">
      <h2 className="font-semibold">Payout account</h2>
      {error && <div className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
      <div>
        <label className="label" htmlFor="bank">Bank</label>
        <select id="bank" className="input" required value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
          <option value="" disabled>
            Choose your bank
          </option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="accountNumber">Account number</label>
        <input
          id="accountNumber"
          className="input"
          required
          inputMode="numeric"
          pattern="\d{6,17}"
          maxLength={17}
          placeholder="0123456789"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
        />
        <p className="mt-1 text-xs text-ink-soft">
          We verify the account name with the bank before saving it. It is never shown publicly.
        </p>
      </div>
      <button className="btn btn-primary w-full" disabled={busy || !bankCode || accountNumber.length < 6}>
        {busy ? 'Verifying…' : 'Verify and save'}
      </button>
    </form>
  );
}

function Withdraw({ balance, onDone }) {
  const minNaira = 1000;
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const availableNaira = Math.floor(balance.availableKobo / 100);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/me/withdrawals', { method: 'POST', body: { amountKobo: Math.round(Number(amount) * 100) } });
      setAmount('');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      <h2 className="font-semibold">Withdraw to your bank</h2>
      {error && <div className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
      <div>
        <label className="label" htmlFor="withdrawAmount">Amount (₦)</label>
        <div className="flex gap-2">
          <input
            id="withdrawAmount"
            className="input"
            required
            type="number"
            min={minNaira}
            max={availableNaira}
            step={1}
            placeholder={String(Math.max(minNaira, availableNaira))}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button className="btn btn-primary" disabled={busy || availableNaira < minNaira}>
            {busy ? 'Sending…' : 'Withdraw'}
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-soft">
          Minimum ₦{minNaira.toLocaleString('en-NG')}
          {balance.pendingWithdrawalKobo > 0 &&
            ` · ${formatKobo(balance.pendingWithdrawalKobo)} already on its way to you`}
        </p>
      </div>
    </form>
  );
}

export default function Dashboard() {
  const { creator, updateProfile, refresh, activation } = useAuth();
  const [dash, setDash] = useState(null);
  const [form, setForm] = useState({
    displayName: creator.displayName,
    bio: creator.bio,
    avatarEmoji: creator.avatarEmoji,
    cupPrice: String(creator.cupPriceKobo / 100),
    goal: String(creator.goalKobo / 100),
  });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPayoutForm, setShowPayoutForm] = useState(false);

  const refreshDash = useCallback(() => {
    api('/me/dashboard')
      .then(setDash)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshDash();
  }, [refreshDash]);

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
    if (!Number.isInteger(goal) || goal < 0 || goal > 10000000) {
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
      refreshDash();
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

  async function startKyc() {
    setBusy(true);
    setError('');
    try {
      await api('/me/kyc/session', { method: 'POST' });
      // Mock flow: decision is applied by the creator (dev only).
      await api('/mock/kyc/decision', { method: 'POST', body: { outcome: 'approved' } }).catch(() => {});
      await refresh();
      refreshDash();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    setBusy(true);
    setError('');
    try {
      await api('/me/activate', { method: 'POST' });
      await refresh();
      refreshDash();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function afterMoneyChange() {
    await refresh();
    refreshDash();
  }

  const stats = dash?.stats;
  const balance = dash?.balance ?? { availableKobo: 0, pendingWithdrawalKobo: 0 };
  const showPayoutSection = !activation?.payoutConfigured || showPayoutForm;

  return (
    <div className="pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          <span className="mr-2">{creator.avatarEmoji}</span>
          {creator.displayName}
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
      <p className="mt-1 font-mono text-sm text-ink-soft">buymepap.app/{creator.username}</p>
      {error && <div className="mt-4 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Available" value={formatKobo(balance.availableKobo)} />
        <Stat label="Total raised" value={stats ? formatKobo(stats.grossKobo) : '—'} />
        <Stat label="Cups of pap" value={stats ? stats.cups : '—'} />
        <Stat label="Supporters" value={stats ? stats.supportCount : '—'} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Checklist
            activation={activation ?? dash?.activation}
            creator={creator}
            busy={busy}
            onKyc={startKyc}
            onPayout={() => setShowPayoutForm(true)}
            onActivate={activate}
          />
          {showPayoutSection ? (
            <PayoutForm
              onSaved={async () => {
                setShowPayoutForm(false);
                await afterMoneyChange();
              }}
            />
          ) : (
            <Withdraw balance={balance} onDone={afterMoneyChange} />
          )}
          {activation?.payoutConfigured && showPayoutForm && (
            <Withdraw balance={balance} onDone={afterMoneyChange} />
          )}
        </div>

        <div className="space-y-6">
          <section className="card">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Recent supporters</h2>
              {stats?.feeKobo > 0 && (
                <span className="text-xs text-ink-soft">fees so far {formatKobo(stats.feeKobo)}</span>
              )}
            </div>
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
                        <b>{s.isAnonymous ? 'Someone' : s.name}</b>
                        {s.isAnonymous && (
                          <span className="ml-1.5 rounded-full bg-ink/5 px-2 py-0.5 text-xs text-ink-soft">anonymous</span>
                        )}
                        <span className="text-ink-soft">
                          {' '}
                          · {s.cups} cup{s.cups > 1 ? 's' : ''} · {timeAgo(s.creditedAt)}
                        </span>
                      </p>
                      {s.message && (
                        <p className="mt-1 whitespace-pre-wrap rounded-xl bg-paper px-3.5 py-2.5 text-sm">{s.message}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-accent">+{formatKobo(s.netKobo)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2 className="font-semibold">Your page</h2>
            <form onSubmit={save} className="mt-4 space-y-4">
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
                <input
                  id="displayName"
                  className="input"
                  required
                  maxLength={40}
                  value={form.displayName}
                  onChange={set('displayName')}
                />
              </div>
              <div>
                <label className="label" htmlFor="bio">Bio (shown on your page)</label>
                <textarea
                  id="bio"
                  className="input resize-none"
                  rows={3}
                  maxLength={300}
                  placeholder="What do you make, and why should people buy you a pap?"
                  value={form.bio}
                  onChange={set('bio')}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="cupPrice">Cup price (₦)</label>
                  <input
                    id="cupPrice"
                    className="input"
                    type="number"
                    min={1}
                    max={100000}
                    required
                    value={form.cupPrice}
                    onChange={set('cupPrice')}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="goal">Support goal (₦, 0 to hide)</label>
                  <input
                    id="goal"
                    className="input"
                    type="number"
                    min={0}
                    step={1000}
                    required
                    value={form.goal}
                    onChange={set('goal')}
                  />
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
        </div>
      </div>
    </div>
  );
}
