import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

/** Step 1: claim the link (username + name + phone). Step 2: the SMS code. */
export default function Claim() {
  const { applySession } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState('details');
  const [form, setForm] = useState({ username: '', displayName: '', phone: '' });
  const [code, setCode] = useState('');
  const [phoneMasked, setPhoneMasked] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const link = form.username.toLowerCase() || 'yourname';

  async function submitDetails(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/auth/claim', {
        method: 'POST',
        body: { ...form, username: form.username.toLowerCase().trim() },
      });
      setPhoneMasked(res.phoneMasked);
      setStep('code');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/auth/otp/verify', { method: 'POST', body: { code } });
      applySession(res);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md pt-8">
      <h1 className="text-2xl font-bold">Get your link</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {step === 'details'
          ? 'No email, no password. Pick your address and prove your phone with one code.'
          : `We sent a code to ${phoneMasked}. Enter it to make your page live.`}
      </p>

      {step === 'details' && (
        <form onSubmit={submitDetails} className="card mt-6 space-y-4">
          {error && <div className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
          <div>
            <label className="label" htmlFor="displayName">Your name</label>
            <input
              id="displayName"
              className="input"
              required
              maxLength={40}
              placeholder="Ada Nwosu"
              value={form.displayName}
              onChange={set('displayName')}
            />
          </div>
          <div>
            <label className="label" htmlFor="username">Username</label>
            <div className="flex items-stretch">
              <span className="flex items-center rounded-l-xl border border-r-0 border-ink/15 bg-ink/5 px-3 font-mono text-sm text-ink-soft">
                buymepap.app/
              </span>
              <input
                id="username"
                className="input rounded-l-none"
                required
                minLength={3}
                maxLength={20}
                pattern="[a-zA-Z0-9_]+"
                placeholder="ada_dev"
                value={form.username}
                onChange={set('username')}
              />
            </div>
            <p className="mt-1 text-xs text-ink-soft">Letters, numbers and underscores. Lowercase.</p>
          </div>
          <div>
            <label className="label" htmlFor="phone">Phone number</label>
            <input
              id="phone"
              className="input"
              required
              type="tel"
              inputMode="tel"
              placeholder="0801 234 5678"
              value={form.phone}
              onChange={set('phone')}
            />
            <p className="mt-1 text-xs text-ink-soft">
              Only used to sign you in and to verify identity later. Never shown publicly.
            </p>
          </div>
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? 'Sending code…' : 'Send my code'}
          </button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={submitCode} className="card mt-6 space-y-4">
          {error && <div className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
          <div>
            <label className="label" htmlFor="code">Verification code</label>
            <input
              id="code"
              className="input text-center text-lg font-bold tracking-[0.4em]"
              required
              inputMode="numeric"
              pattern="\d{4,8}"
              maxLength={8}
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <button className="btn btn-primary w-full" disabled={busy || code.length < 4}>
            {busy ? 'Checking…' : 'Verify and open my page'}
          </button>
          <p className="text-center text-xs text-ink-soft">
            Your link <span className="font-mono">/{link}</span> is reserved while you verify.
          </p>
        </form>
      )}

      <p className="mt-4 text-center text-sm text-ink-soft">
        Already have a page?{' '}
        <Link to="/login" className="font-semibold text-pap-dark">
          Sign in
        </Link>
      </p>
    </div>
  );
}
