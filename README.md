# BuyMePap 🥣

**Buy Me a Coffee, built for Nigeria and Africa.**

[Buy Me a Coffee](https://www.buymeacoffee.com) doesn't let creators in Nigeria — and most other
African countries — actually receive money. Paystack does. BuyMePap gives every creator a public
page where fans buy them a cup of pap with **card, bank transfer or USSD**, and the naira lands in
the creator's local bank.

Sign up, get `yourapp.com/yourname`, drop the link in your bio. No monthly fee — you only pay the
standard Paystack transaction fee.

## What's in this MVP

**Creators**
- One-step signup (email + password + username) with a public page at `/<username>`
- Dashboard: total raised, last-30-days, cups sold, supporter count
- Profile editor: display name, bio, emoji avatar, cup price (₦), support goal
- Copy-page-link button
- Latest supporters list — including the names of people who chose to be anonymous to the public

**Supporters**
- Public page with avatar, bio, raised/cups/supporters stats and goal progress bar
- Support widget: cup presets (1/2/3/5/10), stepper, live total, optional message, optional email
- "Hide my name on the wall" anonymity option
- Redirect to Paystack's hosted checkout, then back to the page with a confirmed banner
- Wall of love showing recent paid support only — pending and failed payments never appear

**Payments (Paystack)**
- `transaction/initialize` → hosted checkout (card / transfer / USSD) → return to page → `verify`
- HMAC-SHA512 signature-verified `charge.success` webhook as the source of truth
- Idempotent fulfillment: a replayed webhook or a double verification can never double-count a tip
- **Mock mode**: with no `PAYSTACK_SECRET_KEY` configured, a local checkout screen stands in for
  Paystack so the entire loop is runnable and testable offline. Mock endpoints hard-404 in live mode.

**Security / correctness**
- bcrypt password hashing, HS256 JWT sessions (7 days)
- Prepared SQLite statements only; strict input validation with reserved-username protection
- Rate limiting on auth and support-creation endpoints
- Amounts stored as integers (kobo) — no float money
- Private fields (email, password hash) never leave the server; anonymous names never hit the public API

## Stack

Node.js (ESM) · Express 5 · built-in `node:sqlite` (WAL) · bcryptjs · jose ·
React 19 · Vite 7 · Tailwind CSS 4 · `node:test` (zero test dependencies)

No native compilation, which keeps installs cheap on low-RAM machines (this runs on Termux/Android).

## Quickstart

```bash
npm install
cp .env.example .env      # optional — sensible defaults without it
npm run dev               # API on http://localhost:8787 (mock payments)
npm run dev:web           # in a second terminal: Vite on :5173, proxies /api
```

Open http://localhost:5173 — create a page, then open your public page and buy yourself a pap.
Mock mode shows a local "Paystack TEST MODE" checkout screen instead of the real one.

For a production-style single-port run:

```bash
npm run build
npm start                 # Express serves dist/ + API on :8787
```

### Going live with Paystack

1. Create a free account at [dashboard.paystack.com](https://dashboard.paystack.com).
   Test mode works immediately; enable live mode after completing onboarding (BVN/account details).
2. Copy your **secret key** (Integration Settings → API Keys & Webhooks) into `.env`:
   ```
   PAYSTACK_SECRET_KEY=sk_live_xxx      # sk_test_xxx for test mode
   JWT_SECRET=<64 hex chars>            # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   APP_URL=https://yourdomain.com       # must be https for live webhooks
   ```
3. Add a webhook in the Paystack dashboard pointing to `https://yourdomain.com/api/webhooks/paystack`
   and set the event to `charge.success`. The endpoint verifies the `x-paystack-signature` header.
4. Restart the server. `/api/config` now reports `paymentsMode: "paystack"` and the mock checkout 404s.
5. Payouts to your Nigerian bank are handled by Paystack on their normal schedule.

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/signup` | — | Create creator, returns `{ token, creator }` |
| POST | `/api/auth/login` | — | Sign in, returns `{ token, creator }` |
| GET | `/api/config` | — | `{ paymentsMode: "mock" \| "paystack" }` |
| GET | `/api/me` | Bearer | Current profile |
| PATCH | `/api/me` | Bearer | Update `displayName`, `bio`, `avatarEmoji`, `cupPrice`, `goal` |
| GET | `/api/me/dashboard` | Bearer | Stats + 10 latest supporters (private view) |
| GET | `/api/pages/:username` | — | Public page: creator, wall of paid supporters, stats |
| POST | `/api/pages/:username/supports` | — | `{ cups, name, message?, isAnonymous, email? }` → `{ authorizationUrl, reference, amountKobo }` |
| GET | `/api/supports/:reference/verify` | — | Payment status; triggers live Paystack verification when pending |
| POST | `/api/webhooks/paystack` | HMAC | `charge.success` → idempotent fulfillment |
| GET/POST | `/api/mock/paystack/*` | — | Mock checkout, mock mode only |

Errors are JSON `{ error }` with proper status codes (400 validation, 401 auth, 404 missing, 409 conflict, 502 provider down).

## Project layout

```
server/
  index.js        entrypoint (listen)
  app.js          Express assembly: webhooks → json → routes → static/SPA → errors
  config.js       env + .env loading, payments mode selection
  db.js           node:sqlite singleton + schema (creators, supports)
  auth.js         bcrypt hashing, jose JWT sign/verify, authRequired middleware
  validators.js   input rules + reserved usernames + amount ceiling
  serialize.js    publicCreator / publicSupport / dashboardSupport
  supports.js     fulfillment (idempotent), queries
  limiters.js     rate limiters
  payments/paystack.js   initialize / verify / webhook signature, mock switch
  routes/         auth, creators (/me, /me/dashboard), pages, supports, webhooks, mock
src/
  main.jsx App.jsx index.css
  lib/    api.js auth.jsx
  pages/  Landing Signup Login Dashboard CreatorPage MockCheckout NotFound
tests/    node:test files — one process per file, temp DB per process
```

## Tests

```bash
npm test            # 20 tests: auth, profiles, full mock tip loop, webhook signatures, idempotency
```

Covers: signup/login validation + duplicates, JWT session enforcement, profile updates and
rejections, public-page privacy (no email/hash), the full initialize → charge → verify → wall loop,
amount math in kobo, anonymity on wall vs dashboard, failed payments staying off the wall, replay
idempotency, webhook HMAC accept/reject, mock endpoints disabled in live mode.

## Known limits & next

- **Paystack only.** Adding Flutterwave first is a provider abstraction already in place
  (`server/payments/`) — same initialize/verify/webhook shape.
- **NGN / West Africa first.** Multi-currency and mobile money (M-Pesa via Flutterwave) are next.
- No password reset / email verification yet — needs a mail provider.
- No image uploads: avatars are emoji by design (cheap, fast, works on flaky connections).
- Creator revenue split / platform fee not implemented — 100% of the tip goes through to the creator.
- Sessions are JWTs in localStorage; move to httpOnly cookies before scaling.
- SQLite is a single-file DB — swap `db.js` for Postgres when deploying multiple instances.
- Explore/discovery pages and payout reconciliation dashboard still to come.
