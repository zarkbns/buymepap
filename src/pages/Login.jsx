import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

/** Sign in with a phone + SMS code. No passwords exist anywhere. */
export default function Login() {
  const { applySession } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function request(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/otp/request', { method: 'POST', body: { phone } });
      setStep('code');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
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
      <h1 className="text-2xl font-bold">Welcome back</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {step === 'phone' ? 'Enter your phone and we will text you a code.' : 'Enter the code we just sent.'}
      </p>

      {step === 'phone' ? (
        <form onSubmit={request} className="card mt-6 space-y-4">
          {error && <div className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
          <div>
            <label className="label" htmlFor="phone">Phone number</label>
            <input
              id="phone"
              className="input"
              required
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0801 234 5678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? 'Sending…' : 'Send my code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="card mt-6 space-y-4">
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
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </form>
      )}

      <p className="mt-4 text-center text-sm text-ink-soft">
        New here?{' '}
        <Link to="/start" className="font-semibold text-pap-dark">
          Get your link
        </Link>
      </p>
    </div>
  );
}
