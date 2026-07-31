@AGENTS.md
# Session handoff — READ THIS FIRST (updated 2026-07-31)

The build prompt below this section is the **original spec**. Its domain-logic
sections (wash-sale rules, sector concentration) are still authoritative. Its
**tech stack, data model, and API endpoint sections are stale** — the user
confirmed early on to keep the stack that actually got built and fill gaps
against the spec, rather than rewrite to match it. Read this section before
touching anything below.

## Actual tech stack (ignore "Tech stack" section below)

- **Next.js 16** (App Router, TypeScript, Tailwind), single full-stack app —
  no separate Python/FastAPI backend, no SnapTrade yet.
- **Supabase**: Postgres with RLS-scoped multi-tenant tables + Auth
  (passwordless magic-link only, no password).
- **Deployed on Vercel**, project `atls4/ledger-check`, production URL
  `https://ledger-check-henna.vercel.app`. GitHub repo
  `tyarram262/Ledger-Check` is connected for auto-deploy on push to `main`.
- AI portfolio-risk digest calls **Claude** (`claude-haiku-4-5` via
  `@anthropic-ai/sdk`), not Gemini.
- Holdings/sales are entered manually or via CSV import — no brokerage sync
  yet (that's Phase 2 below).
- **Next.js 16 renamed `middleware.ts` → `proxy.ts`** (exported fn is
  `proxy`, not `middleware`) — this repo uses the new convention
  (`src/proxy.ts`). AGENTS.md flags that this Next.js version is newer than
  most training data; verify anything else Next.js-related against
  `node_modules/next/dist/docs/` rather than assuming.
- This Mac can't build native npm modules (no working Xcode CLT) — a reason
  `node:sqlite` was originally chosen over `better-sqlite3`, and later a
  non-issue for Supabase's pure-JS client. Keep preferring pure-JS/WASM deps.

## Database (Supabase Postgres — no local migrations folder exists)

Schema was applied directly via the Supabase MCP `apply_migration` tool, not
checked into the repo. To inspect it, query live
(`mcp__supabase__list_tables` / `execute_sql`) — don't look for a
`supabase/migrations/` directory.

- `accounts`, `lots`, `sales`, `settings`, `digest_cache` — each has
  `user_id uuid references auth.users(id) default auth.uid()`, RLS enabled,
  policies scoped to `(select auth.uid()) = user_id`.
- `quotes` — shared price cache, deliberately **not** user-scoped; any
  authenticated user can read/write (non-sensitive data, avoids needing a
  service-role key anywhere).
- `record_sell(p_account_id, p_ticker, p_shares, p_sale_price, p_sale_date)`
  — a `SECURITY INVOKER` Postgres function doing atomic FIFO lot consumption
  + sale insert, called via `supabase.rpc('record_sell', ...)` from
  `recordTrade.ts`. Exists because supabase-js has no client-side
  multi-statement transaction API.
- **No `SUPABASE_SERVICE_ROLE_KEY` is used anywhere in the app, by design.**
  Every RLS policy is written so the user's own session is sufficient. Don't
  introduce the service-role key unless a genuine admin-only operation
  requires it.

## Auth flow — current state (working end to end as of 2026-07-31)

- `src/proxy.ts` + `src/lib/supabase/proxy.ts` (`updateSession`) gate every
  route except `/login` and `/auth/*`.
- `login/actions.ts` derives `emailRedirectTo` from the request's `Origin`
  header so one Supabase project serves both `localhost:3000` and the
  production domain — Supabase only has one `Site URL` setting, so a
  hardcoded `{{ .SiteURL }}` in the email template would break whichever
  environment isn't primary. It also falls back to a friendly message when
  `signInWithOtp`'s error has an unreadable `.message` (Supabase can return
  the literal string `"{}"` when the SMTP provider rejects a send).
- **Two email templates matter, not one** — `signInWithOtp` sends Supabase's
  **"Confirm signup"** template for a brand-new address and **"Magic Link"**
  for returning users. Both are fixed to PKCE-style links:
  ```html
  <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">...</a>
  ```
  Editing a template's source requires custom SMTP to be configured first —
  the built-in sender won't let you touch it. Verified with a real signup,
  a real inbox, and a real clicked link, not just curl.
- **Custom SMTP is live via Resend** (`smtp.resend.com:465`, username
  `resend`, password = the Resend API key, min TLS 1.2, sender
  `onboarding@resend.dev`). This also raised the auth email rate limit from
  2/hour to 30/hour.
- **Known limitation: Resend sandbox mode.** Without a verified domain,
  `onboarding@resend.dev` can only deliver to the *exact* email the Resend
  account was created with — `tanush.yarram@gmail.com`. Every other
  address gets a hard `550` rejection (not a soft failure), including the
  original `tanush.yarram@icloud.com` account. **Sign in with
  `tanush.yarram@gmail.com`** until a domain is verified on Resend — see
  "One dashboard item left" below.
- Supabase Dashboard → Authentication → URL Configuration → Additional
  Redirect URLs needs both `http://localhost:3000/auth/confirm` and
  `https://ledger-check-henna.vercel.app/auth/confirm`.
- No MCP tool covers Auth/SMTP/email-template config — those are
  dashboard-only changes only the user can make.

## Domain-logic gaps filled in beyond the original spec

- IRA-permanent wash-sale distinction (`washSale.ts` — `isIraPermanent` on
  `WashSaleWarning`, per-trigger `isIra`) — implemented and unit-tested.
- Sector-concentration threshold is user-configurable via the `settings`
  table and `/settings` page (default 25%), not hardcoded.
- Disclaimer appears site-wide (`layout.tsx` footer) plus a full `/settings`
  page with known-limitations copy.
- Wash-sale check is intentionally **binary** (any ticker match flags,
  regardless of share counts) — a deliberate, documented MVP simplification,
  not a bug to "fix."

## Verified vs. not yet verified (as of 2026-07-31)

**Verified end to end — nothing about auth or the core flows remains
unproven.** A full authenticated pass was made against the live Supabase
project: `auth.users.last_sign_in_at` is set for both accounts, and a real
"Confirm signup" email was clicked in a real browser (Resend is live, the
template fix is real, not just theoretical). Every API route was exercised
with a real session — account/lot CRUD (incl. delete), CSV import (incl.
malformed-row handling), the `record_sell` FIFO RPC (real consumption, not
just unit-tested), settings GET/POST, Yahoo quote refresh, digest GET/POST
(real Claude call + cache), and proxy redirects both directions. The
wash-sale engine was verified against real DB-backed data: sell-side
IRA-permanent, sell-side deferred cross-account, a case correctly *not*
flagged (outside the 61-day window), and both IRA/non-IRA flavors of
buy-after-loss. `tsc`/`eslint`/50 unit tests are clean; Supabase
security+performance advisors show only pre-existing, by-design items (the
intentionally-unrestricted `quotes` policy; moot leaked-password-protection
since there are no passwords).

**Demo data exists in two places** (both seeded through the app's own API,
not raw SQL — same shape: 4 accounts spanning taxable/Roth/traditional-IRA,
holdings weighted so Information Technology trips the concentration
threshold, 3 recorded sales realizing IRA-permanent + deferred + JNJ
buy-after-loss wash-sale scenarios):
- Under `tanush.yarram@gmail.com` — **the account to actually use**, since
  it's the only one Resend's sandbox mode can currently email.
- Under `tanush.yarram@icloud.com` — the original copy; still in the DB but
  that account is unreachable by email until a domain is verified on
  Resend (see below).

## The 4-phase roadmap to production readiness

1. **Make it hostable at all** (multi-user auth + hosted DB + deploy) —
   **Fully closed, 2026-07-31.** Auth, RLS, every API route, the
   wash-sale/concentration engines against real data, and the Claude digest
   are all verified end to end — see "Verified" above. One caveat carried
   forward, not a Phase 1 gap: Resend sandbox mode limits which address can
   currently receive auth emails (see "Auth flow" above) — solvable by
   verifying a domain whenever that's convenient, and worth bundling with
   Phase 4 since that phase needs it too.
2. **Cut onboarding friction** — SnapTrade brokerage sync so holdings and
   transactions import automatically instead of manual entry/CSV. Not
   started.
3. **Trust & polish** — error tracking (Sentry), rate-limit the digest
   endpoint, and (if SnapTrade lands) encrypt stored brokerage tokens plus a
   real privacy policy/ToS. Not started.
4. **Get users** — a landing/waitlist page pitching the cross-account
   wash-sale angle; direct outreach in DIY-investor communities (Bogleheads,
   r/personalfinance, r/investing) rather than paid ads. Not started.

## One dashboard item left for whenever Phase 4 starts

**Authentication → SMTP Settings → verify a domain on Resend**, then switch
Sender email off `onboarding@resend.dev` to an address on that domain. Not
blocking anything today (single-user use works fine on
`tanush.yarram@gmail.com`), but required before other people can sign up —
Resend's sandbox mode hard-rejects any recipient besides the account's own
verified email. See "Auth flow" above for the full story.

---

# Ledger-Check MVP — Claude Code Build Prompt

## Project pitch

Ledger-Check is a cross-brokerage "gut check" tool for DIY investors. It answers two questions
no single broker can answer, because no broker sees your other accounts:

1. **Pre-trade:** "If I sell/buy this position right now, will it trigger a wash sale given
   activity in ANY of my other accounts (including IRAs), and how does it change my sector
   concentration?"
2. **Post-trade / ongoing:** "Which of my trades this year are at risk of being wash sales once
   all my accounts are considered together?"

This is an **informational tool, not tax or investment advice.** That disclaimer must appear on
every screen that shows wash-sale or tax-lot output — bake it into the UI from the first commit,
not as an afterthought.

## Who this is for (MVP target user)

A single user (you, first) connecting 2+ brokerage/IRA accounts (e.g., Robinhood + Fidelity IRA,
or Schwab taxable + Vanguard IRA) who wants to avoid accidentally disallowing a loss by
repurchasing a "substantially identical" security in a different account within the wash-sale
window.

## Core domain logic — get this exactly right, it's the whole product

**IRS wash-sale rule (26 U.S.C. §1091), as implemented:**
- Window: 30 calendar days **before** the sale, the day **of** the sale, and 30 calendar days
  **after** the sale (61-day window total).
- Applies to "substantially identical" securities — for MVP, treat **same ticker/CUSIP** as
  substantially identical; do NOT attempt to detect "substantially identical" across different
  tickers (e.g., different S&P 500 index funds) in v1 — flag that as a known limitation in the UI,
  not silently ignored.
- Applies **across every account owned by the same taxpayer**, including IRAs and a spouse's
  accounts if filing jointly (MVP: just the same taxpayer's accounts, skip spousal for now).
- **Special IRA rule (Rev. Rul. 2008-5):** if the repurchase happens in an IRA, the loss is
  **permanently disallowed** (not just deferred into a higher cost basis like a normal wash sale).
  This is a materially worse outcome than a same-taxable-account wash sale — the tool must
  distinguish and flag this case specifically, since it's the scenario brokers are worst at
  catching and users are most likely to trigger by accident.
- A wash sale defers the disallowed loss into the cost basis of the replacement shares (except
  the IRA case above, where it's just gone).

**Sector concentration gut-check:**
- Given the user's current aggregate position across all connected accounts, compute % of total
  portfolio value by GICS sector (or a simplified sector taxonomy if a full GICS mapping isn't
  available — use a free ticker → sector mapping, cache it, and flag tickers with no mapping
  rather than guessing).
- Simulate the proposed trade (buy or sell N shares of TICKER) and show before/after sector
  allocation, with a plain-English flag if any sector exceeds a user-configurable threshold
  (default 25%) after the trade.

## Tech stack

- **Backend:** Python 3.12 + FastAPI (matches your existing backtesting MVP stack) + PostgreSQL
  + SQLAlchemy + Alembic for migrations. Pydantic v2 for schemas.
- **Brokerage aggregation:** SnapTrade (https://snaptrade.com) — purpose-built for connecting
  to brokerage accounts (including Robinhood) and pulling positions, balances, and transaction
  history with real cost-basis/tax-lot data, unlike Plaid which is banking-first. Use their
  sandbox/demo accounts for development. Abstract the aggregator behind an interface
  (`BrokerageProvider`) so Plaid Investments or manual CSV import can be added later without a
  rewrite.
- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind. Keep it a single dashboard app,
  no marketing site yet.
- **Auth:** Clerk or simple email/password with NextAuth — don't build custom auth for an MVP.
- **Background jobs:** APScheduler or a simple cron-triggered FastAPI endpoint for nightly
  transaction sync (no need for Celery/Redis queueing at MVP scale — one user, low volume).
- **Deployment target:** Fly.io or Railway for backend+Postgres, Vercel for frontend. Keep it
  cheap and simple; this is a prototype to validate the wedge, not production infra yet.

## Data model (core tables)

```
users
  id, email, created_at

brokerage_connections
  id, user_id, provider ("snaptrade"), external_account_id, account_type
  ("taxable" | "traditional_ira" | "roth_ira" | "other"), display_name, connected_at

positions
  id, brokerage_connection_id, ticker, cusip (nullable), quantity, avg_cost_basis,
  market_value, sector (nullable, from ticker→sector lookup), as_of

transactions
  id, brokerage_connection_id, ticker, cusip (nullable), transaction_type ("buy" | "sell"),
  quantity, price, trade_date, realized_gain_loss (nullable, for sells), tax_lot_id (nullable)

tax_lots
  id, brokerage_connection_id, ticker, quantity, cost_basis_per_share, acquired_date,
  disposed_date (nullable), closed_by_transaction_id (nullable)

wash_sale_flags
  id, user_id, triggering_transaction_id, matched_transaction_id, ticker,
  window_start, window_end, disallowed_loss_amount, is_ira_permanent_disallowance (bool),
  detected_at
```

## API endpoints (MVP scope)

- `POST /connections` — start SnapTrade connection flow, store resulting account
- `GET /connections` — list connected accounts for the user
- `POST /sync` — trigger a manual sync of positions/transactions across all connections
- `GET /portfolio/summary` — aggregate positions across accounts with sector breakdown
- `GET /wash-sales` — list detected wash-sale flags, sorted by date, with IRA-permanent ones
  visually distinct
- `POST /pretrade-check` — body: `{ ticker, action: "buy"|"sell", quantity }` → returns
  `{ wash_sale_risk: {...} | null, sector_impact: {...} }`

## Wash-sale detection algorithm (pseudocode for the engine)

```
for each sell_transaction with a loss (realized_gain_loss < 0):
    window = [sell_transaction.trade_date - 30 days, sell_transaction.trade_date + 30 days]
    for each connection in user's connections:
        for each txn in connection.transactions:
            if txn.ticker == sell_transaction.ticker
               and txn.transaction_type == "buy"
               and txn.trade_date within window
               and txn.id != sell_transaction.id:
                flag = create_wash_sale_flag(
                    triggering=sell_transaction, matched=txn,
                    is_ira_permanent = (connection.account_type in
                        ["traditional_ira", "roth_ira"])
                )
```

Run this across ALL connected accounts together, not per-account — that cross-account check is
the entire value proposition.

## Frontend pages (MVP scope — keep it to four screens)

1. **Connect accounts** — SnapTrade connection flow, list of connected accounts with type
   (taxable/IRA) clearly labeled.
2. **Dashboard** — aggregate portfolio value, sector allocation pie chart, list of active
   wash-sale flags (IRA-permanent ones flagged in red with an explanation of why they're worse).
3. **Pre-trade check** — simple form: ticker, buy/sell, quantity → plain-English result:
   "Selling 50 shares of AAPL now would NOT trigger a wash sale" or "⚠️ This would trigger a
   wash sale — you bought 20 shares of AAPL in your Fidelity IRA on [date], which permanently
   disallows this loss." Plus the sector-concentration before/after.
3. **Disclaimer/settings** — the informational-only disclaimer, plus the sector-concentration
   threshold setting.

## Build order (work through these phases sequentially, confirm with me before moving to the next)

1. **Scaffold:** FastAPI + Postgres + Alembic project structure, Next.js frontend scaffold,
   docker-compose for local dev, basic health-check endpoint wired end to end.
2. **Data model + migrations:** implement the schema above, seed script with 2-3 fake connected
   accounts and realistic fake transaction history (including at least one deliberate cross-account
   wash sale and one IRA-permanent-disallowance case) so the detection logic has something to catch
   from day one.
3. **Wash-sale engine + tests:** implement the detection algorithm as a standalone, well-tested
   Python module first (pure functions, no DB/API dependencies) with unit tests covering: same-account
   wash sale, cross-account wash sale, IRA-permanent case, and a case that should NOT flag (outside
   the 61-day window). Get this rock solid before touching the API layer — this module is the product.
4. **Sector concentration engine:** ticker → sector lookup (start with a static CSV of S&P 500
   constituents + sectors, cached; flag unmapped tickers rather than guessing) and the before/after
   simulation logic, also unit tested.
5. **API layer:** wire the endpoints above to the engines and data model.
6. **SnapTrade integration:** implement the `BrokerageProvider` interface against SnapTrade's
   sandbox, replacing the seed data with real synced positions/transactions.
7. **Frontend:** the four screens, calling the API. Keep styling minimal and clean — this doesn't
   need to be beautiful yet, it needs to be trustworthy and clear.
8. **Deploy:** get it live on Fly.io/Railway + Vercel so you can actually connect your own real
   accounts and dogfood it.

## Explicit non-goals for this MVP

- No trade execution — this tool only reads and simulates, never places orders.
- No tax-advice framing anywhere in copy — "informational gut-check," never "tax advice."
- No support for spousal accounts, multi-currency, or non-US tax rules.
- No "substantially identical but different ticker" detection (e.g. VOO vs SPY) — out of scope
  for v1, but note it in the UI as a known limitation.
- No multi-user/team features — single user auth is enough to validate the wedge.

Start with Phase 1 (scaffold) and show me the project structure before writing business logic.