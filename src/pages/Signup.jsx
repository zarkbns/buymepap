import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ displayName: '', email: '', username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signup({ ...form, username: form.username.toLowerCase() });
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md pt-8">
      <h1 className="text-2xl font-bold">Create your page</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Your supporters will find you at{' '}
        <span className="font-mono text-ink">/{form.username.trim().toLowerCase() || 'yourname'}</span>
      </p>

      <form onSubmit={submit} className="card mt-6 space-y-4">
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
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            required
            placeholder="you@example.com"
            value={form.email}
            onChange={set('email')}
          />
        </div>
        <div>
          <label className="label" htmlFor="username">Username</label>
          <input
            id="username"
            className="input"
            required
            minLength={3}
            maxLength={20}
            pattern="[a-zA-Z0-9_]+"
            placeholder="ada_dev"
            value={form.username}
            onChange={set('username')}
          />
          <p className="mt-1 text-xs text-ink-soft">Letters, numbers and underscores. Lowercase.</p>
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            required
            minLength={8}
            maxLength={128}
            placeholder="At least 8 characters"
            value={form.password}
            onChange={set('password')}
          />
        </div>
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? 'Creating…' : 'Create page'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-ink-soft">
        Already have a page?{' '}
        <Link to="/login" className="font-semibold text-pap-dark">
          Sign in
        </Link>
      </p>
    </div>
  );
}
