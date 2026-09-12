import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

const steps = [
  {
    title: 'Claim your page',
    body: 'Sign up in 30 seconds and get your own address — buymeapap.app/yourname. No approval queue, no paperwork.',
  },
  {
    title: 'Set your cup price',
    body: '₦200, ₦1,000, ₦5,000 — whatever a cup of pap is worth for the work you make.',
  },
  {
    title: 'Share the link',
    body: 'Put it in your bio. Supporters pay with card, bank transfer or USSD — you receive naira in your bank.',
  },
];

const features = [
  { emoji: '🇳🇬', text: 'Built for Nigeria — naira first, payouts to your local bank' },
  { emoji: '💳', text: 'Cards, bank transfer and USSD via Paystack' },
  { emoji: '🕶️', text: 'Supporters can stay anonymous on the wall' },
  { emoji: '🎯', text: 'Set a support goal and watch supporters pour in' },
];

function Preview() {
  return (
    <div className="card w-full max-w-sm">
      <div className="flex items-center gap-3">
        <span className="text-5xl">🎙️</span>
        <div>
          <p className="font-bold">Zainab Abioye</p>
          <p className="text-sm text-ink-soft">@zainabt · Tech podcast</p>
        </div>
      </div>
      <div className="mt-4 h-2 rounded-full bg-ink/10">
        <div className="h-2 w-3/4 rounded-full bg-pap-dark" />
      </div>
      <p className="mt-1 text-xs text-ink-soft">75% of the ₦25,000 goal</p>
      <div className="mt-4 rounded-xl bg-pap/15 p-3">
        <p className="text-sm">
          <b>Chidi</b> bought 3 cups of pap
        </p>
        <p className="mt-1 rounded-lg bg-white px-3 py-2 text-sm">
          Best Lagos tech podcast, full stop. Keep going!
        </p>
      </div>
      <p className="mt-3 text-sm">
        <b>Someone</b> bought 1 cup of pap · <span className="text-ink-soft">anonymous</span>
      </p>
      <div className="mt-5 rounded-full bg-pap-dark py-2.5 text-center text-sm font-semibold text-white">
        Buy Zainab a pap — ₦500
      </div>
    </div>
  );
}

export default function Landing() {
  const { creator } = useAuth();
  return (
    <div>
      <section className="grid items-center gap-10 py-12 lg:grid-cols-2 lg:py-20">
        <div>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Your people want to <span className="text-pap-dark">buy you a pap</span>.
          </h1>
          <p className="mt-4 text-lg text-ink-soft">
            Buy Me a Coffee doesn't work for Nigerian and African creators. We do — a public page
            where fans support your work in naira, straight to your bank.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {creator ? (
              <>
                <Link to="/dashboard" className="btn btn-primary">
                  Go to dashboard
                </Link>
                <Link to={`/${creator.username}`} className="btn btn-ghost">
                  View my page
                </Link>
              </>
            ) : (
              <>
                <Link to="/signup" className="btn btn-primary">
                  Create your page — free
                </Link>
                <Link to="/login" className="btn btn-ghost">
                  Sign in
                </Link>
              </>
            )}
          </div>
          <p className="mt-4 text-sm text-ink-soft">
            No monthly fees. You only pay the standard Paystack transaction fee.
          </p>
        </div>
        <div className="flex justify-center">
          <Preview />
        </div>
      </section>

      <section className="py-10">
        <h2 className="text-center text-2xl font-bold">How it works</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {steps.map((step, i) => (
            <div key={step.title} className="card">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pap-dark font-bold text-white">
                {i + 1}
              </span>
              <h3 className="mt-3 font-semibold">{step.title}</h3>
              <p className="mt-1 text-sm text-ink-soft">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-10">
        <div className="grid gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.text} className="flex items-center gap-3 rounded-2xl bg-white/70 px-4 py-3 ring-1 ring-ink/5">
              <span className="text-2xl">{f.emoji}</span>
              <p className="text-sm">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-16 text-center">
        <h2 className="text-3xl font-bold">Stop losing support because of borders.</h2>
        <p className="mx-auto mt-3 max-w-md text-ink-soft">
          Podcasters, devs, writers, comedians, designers — your next ₦1,000 is one page away.
        </p>
        <Link to={creator ? '/dashboard' : '/signup'} className="btn btn-primary mt-6 text-base">
          {creator ? 'Go to dashboard' : 'Claim your page now'}
        </Link>
      </section>
    </div>
  );
}
