import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

const steps = [
  {
    title: 'Claim your link',
    body: 'Your name and your phone — that is the whole signup. Your page goes live at buymepap.app/yourname in under a minute.',
  },
  {
    title: 'Share it anywhere',
    body: 'Drop the link in your bio. Supporters pay with card, bank transfer or USSD — no account needed.',
  },
  {
    title: 'Switch on payments when ready',
    body: 'Verify your identity once, add your bank account, and every pap lands in your bank as naira.',
  },
];

const features = [
  { emoji: '🇳🇬', text: 'Built for Nigeria — naira in, naira out, local bank payouts' },
  { emoji: '💳', text: 'Cards, bank transfer and USSD via Flutterwave' },
  { emoji: '🕶️', text: 'Supporters can hide their name on your wall' },
  { emoji: '🧾', text: 'Every pap is ledgered — you always know your balance' },
];

function Preview() {
  return (
    <div className="relative w-full max-w-sm" aria-hidden="true">
      <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-pap/20 blur-3xl" />
      <div className="card pop-in w-full" style={{ animationDelay: '180ms' }}>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Your link</p>
        <p className="mt-1 truncate font-mono text-lg font-bold">buymepap.app/zainab</p>

        <div className="mt-4 flex items-center justify-between rounded-xl bg-pap/15 px-4 py-3">
          <span className="text-sm font-semibold">Balance</span>
          <span className="text-lg font-extrabold">₦42,500</span>
        </div>
        <button type="button" className="btn btn-primary mt-3 w-full">Withdraw to bank</button>

        <div className="mt-5 rounded-xl bg-pap/15 p-3">
          <p className="text-sm">
            <b>Chidi</b> bought 3 cups of pap
          </p>
          <p className="mt-1.5 rounded-lg bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-ink/5">
            Best Lagos tech podcast, full stop. Keep going!
          </p>
        </div>
        <p className="mt-3 text-sm">
          <b>Someone</b> bought 1 cup of pap · <span className="text-ink-soft">anonymous</span>
        </p>
      </div>
    </div>
  );
}

export default function Landing() {
  const { creator } = useAuth();

  return (
    <div>
      <section className="grid items-center gap-10 py-10 sm:py-14 lg:grid-cols-2 lg:py-20">
        <div>
          <h1
            className="reveal text-4xl font-extrabold leading-[1.08] tracking-[-0.02em] sm:text-5xl sm:leading-[1.05] sm:tracking-[-0.03em]"
            style={{ '--reveal-dur': '420ms' }}
          >
            Get your link. <span className="text-pap-dark">Get paid.</span>
          </h1>
          <p className="reveal mt-4 text-lg leading-relaxed text-ink-soft" style={{ '--i': 1, '--reveal-dur': '420ms' }}>
            One link for your bio. Fans buy you a cup of pap in naira — with card,
            transfer or USSD — and it lands in your bank. No email, no password, no paperwork to start.
          </p>
          <div className="reveal mt-8 flex flex-wrap gap-3" style={{ '--i': 2, '--reveal-dur': '420ms' }}>
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
                <Link to="/start" className="btn btn-primary">
                  Get your link — free
                </Link>
                <Link to="/login" className="btn btn-ghost">
                  Sign in
                </Link>
              </>
            )}
          </div>
          <p className="reveal mt-4 text-sm text-ink-soft" style={{ '--i': 3, '--reveal-dur': '420ms' }}>
            No monthly fee. Verify your identity only when you want to receive money.
          </p>
        </div>
        <div className="flex justify-center lg:justify-end">
          <Preview />
        </div>
      </section>

      <section className="py-10">
        <h2 className="text-center text-2xl font-bold tracking-tight">How it works</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {steps.map((step, i) => (
            <div key={step.title} className="card reveal" style={{ '--i': i }}>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-pap-dark text-sm font-bold text-white">
                {i + 1}
              </span>
              <h3 className="mt-3.5 font-semibold">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-10">
        <div className="grid gap-3 sm:grid-cols-2">
          {features.map((f, i) => (
            <div
              key={f.text}
              className="reveal flex items-center gap-3.5 rounded-2xl bg-white/80 px-4 py-3.5 ring-1 ring-ink/5"
              style={{ '--i': i }}
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-pap/20 text-xl ring-1 ring-pap/30">
                {f.emoji}
              </span>
              <p className="text-sm leading-snug">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-10 lg:py-14">
        <div className="reveal rounded-3xl bg-ink px-6 py-12 text-center sm:px-12">
          <h2 className="text-3xl font-extrabold tracking-tight text-paper">
            Your next ₦1,000 is one link away.
          </h2>
          <p className="mx-auto mt-3 max-w-md leading-relaxed text-paper/70">
            Podcasters, devs, writers, comedians, designers — claim your name before someone else does.
          </p>
          <Link
            to={creator ? '/dashboard' : '/start'}
            className="btn mt-7 bg-pap text-ink hover:brightness-105"
          >
            {creator ? 'Go to dashboard' : 'Claim your link now'}
          </Link>
        </div>
      </section>
    </div>
  );
}
