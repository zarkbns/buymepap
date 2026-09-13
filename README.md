# BuyMePap 🥣

**Get your link. Get paid.**

BuyMePap is a creator-payment platform for Nigeria. Claim a public link in
seconds — no email, no password — share it, and when you're ready to receive
money, verify your phone and identity, add your bank account, and switch
payments on. Fans buy you a cup of pap with **card, bank transfer or USSD**
via Flutterwave, and the naira lands in your bank.

```
Claim your link → verify phone → your page is live
              ↘ when you want money:
                verify identity (KYC) → add payout account → payments active
```

## The creator lifecycle

| Stage | What happens | State |
| --- | --- | --- |
| 1. Claim a link | Username + display name + phone → SMS OTP. No email/password. | `draft`, username reserved for 7 days |
| 2. Verify phone | Enter the code. The public page goes live. | `active`, phone verified |
| 3. Verify identity | Sumsub's WebSDK opens in the browser (ID document + selfie); the decision is read back server-side. | KYC `pending → approved / rejected` |
| 4. Add payout account | Bank + account number, name resolved by the provider. | payout `verified` |
| 5. Activate payments | One tap. The page can now collect money. | `payments_active` |

**An unverified or unactivated page cannot collect money** — the public API
refuses payment initialization unless every step above is complete, and the
public page shows an inactive state instead of a support form.

Username safety: names are unique at the database level, platform-impersonating
names are reserved, and abandoned drafts (never phone-verified) are swept after
7 days so the username returns to the pool.

## Money handling

- **Integer kobo only.** Every amount in the database, API and ledger is an
  integer in the smallest currency unit (1 ₦ = 100 kobo). No floats, anywhere.
- **Explicit platform fee.** `PLATFORM_FEE_BASIS_POINTS` (default 0 at launch)
  is snapshotted onto every payment; `gross = fee + net` is recorded once and
  never recalculated from later config.
- **Append-only ledger.** Credits (net support) and debits (withdrawal
  reserves) are posted with unique idempotency keys
  (`payment:{id}:net`, `withdrawal:{id}:reserve`, `withdrawal:{id}:reversal`).
  Creator balances are derived from the ledger — there is no mutable balance
  column to drift.
- **Payment state machine:** `pending → success | failed`. Fulfillment is
  guarded by a conditional `UPDATE ... WHERE status='pending'` **plus** the
  ledger idempotency key, so duplicate webhooks, repeated verification,
  retries and concurrent requests can never double-credit a creator.
- **Webhook idempotency.** Every provider event is stored (`provider_events`)
  keyed by the provider's event id with a payload hash; replays are ACKed
  without reprocessing, and events whose processing failed are retried on the
  next delivery.
- **Reconciliation.** Payment status is always checked against the provider
  server-side (`verify_by_reference`); a browser redirect alone can never mark
  a payment successful. A provider-reported amount that doesn't match the
  stored amount is flagged `amount_mismatch` and never credited.
- **Withdrawal lifecycle:** `requested → processing → paid | failed |
  reversed`. Funds are reserved by a guarded ledger debit inside one
  `BEGIN IMMEDIATE` transaction (check balance + insert is atomic), so
  concurrent requests cannot double-spend. A definite provider failure returns
  reserved funds exactly once; an *unknown* outcome (timeout) stays in
  `processing` until reconciliation asks the provider what happened — never
  blindly reversed, which is how double payouts happen.

## Architecture

```
server/
  index.js            migrate → sweep → listen (deterministic startup)
  app.js              headers, CORS, cookies, CSRF, routes, SPA, error hygiene
  config.js           env with fail-fast production validation
  db.js               node:sqlite (WAL) + transaction() helper + migration runner
  migrations/         v1 legacy baseline → v2 financial domain (data-preserving)
  security/           session cookies + CSRF (session.js), phone/OTP crypto (phone.js)
  otp.js              hashed, single-use, attempt-capped OTP challenges
  sms/                delivery boundary (generic HTTP gateway | mock outbox)
  payments/           provider interface + Flutterwave adapter + mock adapter
  kyc/                Sumsub adapter (mints the short-lived SDK token) + mock
  domain/             onboarding, profile, payments, ledger, withdrawals, events
  routes/             auth (claim/OTP), me (profile/KYC/payout/withdrawals),
                      pages (public + payment init), payments (status),
                      webhooks (flutterwave, sumsub), mock, banks, admin
src/                  React 19 + Vite 7 + Tailwind 4 SPA
tests/                node:test — one process per file, temp DB per process
```

**Provider isolation.** The financial domain depends only on the documented
interface in `server/payments/index.js` (checkout, verify, webhook parse,
bank resolve, payout, payout status). Flutterwave specifics live in one file;
Paystack was removed entirely. Sumsub secrets never leave the server — the
browser receives only a short-lived SDK token.

## Quickstart

```bash
npm install
cp .env.example .env      # optional in dev — defaults run fully mocked
npm run dev               # API on http://localhost:8787 (mock everything)
npm run dev:web           # Vite on :5173, proxies /api
```

Open http://localhost:5173 — claim a link, grab the OTP from the mock outbox
(`GET /api/mock/sms/latest?phone=…`), and walk the whole lifecycle including
mock KYC approval and a mock payout, without any provider account.

Production-style single port:

```bash
npm run build
npm start                 # Express serves dist/ + API on :8787
```

## Going live

1. **Flutterwave** (dashboard → Settings → API): copy the secret key, public
   key, entity SID (`account_sid`), and set a webhook hash. Put them in `.env`
   with `PAYMENTS_PROVIDER=flutterwave`.
2. **Webhook:** point Flutterwave at `https://yourdomain.com/api/webhooks/flutterwave`.
   The endpoint accepts both the `verif-hash` header and the newer
   `flutterwave-signature` HMAC, then verifies the transaction server-side
   before crediting anyone.
3. **Sumsub** (Dev Space → API keys): client id + secret + webhook secret +
   level name. `KYC_PROVIDER=sumsub`. Point Sumsub webhooks at
   `https://yourdomain.com/api/webhooks/sumsub`. The WebSDK token carries `APP_URL`
   as its `applicationUrl` claim and Sumsub refuses the widget on an origin
   mismatch, so `APP_URL` must be the origin the page actually loads from (the
   frontend origin, in a split deploy). If Sumsub serves a different widget build,
   point `SUMSUB_SDK_URL` at that exact script URL — no code change.
4. **SMS:** set `SMS_PROVIDER=http` with your gateway's URL + token (JSON
   `POST {to, from, message}`). Any Nigerian aggregator with a simple HTTP API
   works.
5. **Secrets:** `JWT_SECRET` (≥ 32 random chars), `ADMIN_TOKEN` if you want the
   ops endpoints. The server refuses to boot in production with anything
   missing, weak, or test-flavoured.
6. Withdrawal payouts use Flutterwave transfers; set
   `MIN_WITHDRAWAL_KOBO`/`MAX_WITHDRAWAL_KOBO` to your risk appetite.

> The Flutterwave/Sumsub HTTP flows are integration-tested against a fake
> in-process provider; the exact live endpoint paths are centralised in
> `server/payments/flutterwave.js` and `server/kyc/sumsub.js` and should be
> smoke-tested with real sandbox credentials before public launch. That includes
> the WebSDK script filename (`sumsub.websdk.2.0.0.js`), which Sumsub pins per
> release — the loader accepts either the CDN directory or an exact script URL via
> `SUMSUB_SDK_URL`, and handles both the 1.x and 2.x widget APIs.

## Deploying

The ledger is a single SQLite file, so the API needs one persistent process
with a writable disk: Vercel for the SPA, Railway (or Render/Fly) for the API,
with Vercel rewriting `/api/*` to the backend (same-origin, no CORS needed).

### Backend on Railway

`railway.json` is committed: Nixpacks → `npm start`, health check `/healthz`.

1. Deploy `main`; add a **Volume** at `/data` and set `PAP_DB_PATH=/data/buymepap.db`.
2. Set every variable from the "Going live" list. `PORT` is injected.
3. Node ≥ 24 is pinned in `engines` for flag-free `node:sqlite`.

### Frontend on Vercel

Framework preset **Vite**, build `npm run build`, output `dist`, rewrites:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://<railway-domain>/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

No secrets are ever needed by the frontend; every provider call is
server-side, and the session is an httpOnly cookie.

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/claim` | — | Claim a username + send OTP → `{ creator, phoneMasked }` |
| POST | `/api/auth/otp/request` | — | Sign-in OTP for an existing phone (never enumerates) |
| POST | `/api/auth/otp/verify` | pending cookie | Verify code → full session cookie |
| GET | `/api/auth/session` | cookie | Current creator or `null` |
| POST | `/api/auth/logout` | — | Clear the session |
| POST | `/api/auth/maintenance/sweep` | — | Release expired username reservations |
| GET | `/healthz` | — | `{ ok, paymentsProvider, kycProvider, smsProvider }` |
| GET | `/api/config` | — | Public provider modes (no secrets) |
| GET/PATCH | `/api/me` | cookie/Bearer | Own profile (`cupPrice`, `goal` in naira; stored as kobo) |
| GET | `/api/me/dashboard` | auth | Stats, balance, activation states, recent support, withdrawals |
| POST | `/api/me/kyc/session` | auth | Start/resume Sumsub verification → `{ token, userId, scriptUrl }` (or `{ mock }`), never a secret |
| POST | `/api/me/kyc/refresh` | auth | Server-side check of the review state |
| PUT | `/api/me/payout-account` | auth | Bank + account number, verified via provider |
| POST | `/api/me/activate` | auth | Turn payments on when every requirement is met |
| POST/GET | `/api/me/withdrawals` | auth | Request (atomic reserve) / list |
| GET | `/api/pages/:username` | — | Public page (hidden for draft/suspended) |
| POST | `/api/pages/:username/supports` | — | Create pending payment → `{ checkoutUrl, reference }` |
| GET | `/api/payments/:reference` | — | Authoritative status (server-side provider verify) |
| GET | `/api/banks` | — | Public bank list for payout setup |
| POST | `/api/webhooks/flutterwave` | signature | `charge.completed`, `transfer.completed` |
| POST | `/api/webhooks/sumsub` | signature | Applicant review decisions |
| GET/POST | `/api/mock/*` | — | Dev-only mocks (404 in production) |
| POST | `/api/admin/*` | admin token | Reconcile payments/withdrawals, sweep |

Errors are JSON `{ error }` (400 validation, 401 auth, 403 CSRF/ownership,
404 missing, 409 conflict/state, 429 rate-limited, 502 provider down).
Provider error bodies, stack traces and secrets never reach the client.

## Security notes

- httpOnly, SameSite=Lax, `Secure`-in-production session cookies (Bearer
  accepted for non-browser clients); double-submit CSRF token + origin
  checks on every unsafe request; webhooks exempt (signature-authenticated).
- Strict production config: no ephemeral JWT secret, https-only app URL,
  no mock SMS, test keys rejected.
- Rate limits per route: claiming, OTP delivery (per phone), OTP verification,
  payment initialization, withdrawals, page reads.
- Bank account numbers are stored server-side for payouts and only ever
  serialized as last-4 digits; phone numbers, KYC refs and provider payloads
  never appear in API responses or logs.
- `express.json` body limit, no-store on API responses, hardened headers.
- `Permissions-Policy` denies camera, microphone and geolocation everywhere; the
  only grant in the file is `https://*.sumsub.com`, and it appears solely while
  `KYC_PROVIDER=sumsub` — mock/dev keeps the full denial.
- Nothing is fetched from the identity provider until a creator explicitly starts
  verification: Sumsub's WebSDK script is injected on that click, and the token
  it runs on expires in 30 minutes and is minted server-side.

## Tests

```bash
npm test     # 79 tests, ~16s, zero external dependencies or credentials
```

Covers the whole lifecycle end to end against the mock provider: onboarding
and OTP abuse limits, username collisions and reservation sweeps, activation
gating, payment math and fulfillment idempotency (including concurrent
charge/verify races), webhook signatures and event dedupe, fee snapshots and
ledger accounting, withdrawal double-spend protection, authorization scoping,
CSRF, and production config fail-fast. It also pins the identity-verification
boundary: the SDK token binds to `APP_URL`, the widget script is injected only on
an explicit start (both WebSDK APIs, failure and retry), and the camera policy
opens for Sumsub only in live KYC mode.

## Known limits & next

- SMS is a generic HTTP gateway adapter; a specific aggregator (Termii,
  Infobip, Africa's Talking) is a drop-in inside `server/sms/index.js`.
- Flutterwave/Sumsub endpoint paths are implemented from the published API
  docs and centralized in one file each; run a sandbox smoke test with real
  credentials before launch (no credentials were available for this build).
- No password reset needed anymore — but phone-number change is not yet
  supported (deliberately; it is a KYC-sensitive flow).
- Balances are available immediately after webhook settlement; settlement
  windows (T+1 holds) are a product decision for later.
- Sessions are stateless JWTs; logout clears the cookie but a stolen token is
  valid until expiry (add a server-side revocation list if that ever matters).
- Explore/discovery, memberships, shops, posts, community, crypto/P2P are
  explicitly out of scope for now.
