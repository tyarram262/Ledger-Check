@AGENTS.md
# Session handoff — READ THIS FIRST (updated 2026-07-30)

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

## Auth flow — known rough edges

- `src/proxy.ts` + `src/lib/supabase/proxy.ts` (`updateSession`) gate every
  route except `/login` and `/auth/*`.
- `login/actions.ts` derives `emailRedirectTo` from the request's `Origin`
  header so one Supabase project serves both `localhost:3000` and the
  production domain — Supabase only has one `Site URL` setting, so a
  hardcoded `{{ .SiteURL }}` in the email template would break whichever
  environment isn't primary.
- **Two separate email templates matter, not one.** `signInWithOtp` sends
  Supabase's **"Confirm signup"** template for a brand-new email address and
  **"Magic Link"** for returning users. Both need their link changed to:
  ```html
  <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">...</a>
  ```
  As of 2026-07-30, **only "Magic Link" had been fixed** — "Confirm signup"
  still had the default `{{ .ConfirmationURL }}`, which was the actual cause
  of a "Safari can't connect" / `otp_expired` failure on first sign-in.
  **Verify both templates are fixed before assuming auth works.**
- Supabase Dashboard → Authentication → URL Configuration → Additional
  Redirect URLs needs both `http://localhost:3000/auth/confirm` and
  `https://ledger-check-henna.vercel.app/auth/confirm`.
- Supabase's built-in email sender is rate-limited (observed at 2
  emails/hour) — expect to hit this during manual testing. A prior custom
  SMTP misconfiguration (Host field set to `http://localhost:3000`, invalid)
  was found and fixed by disabling custom SMTP / falling back to the
  built-in sender.
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

- **Verified — including the full authenticated click-through that was the
  last open item.** The magic-link rate limit / broken "Confirm signup"
  template blocked testing via a real inbox, so the click-through was done
  by reading the PKCE token straight out of `auth.one_time_tokens` via the
  Supabase MCP connection (that column holds exactly the value
  `{{ .TokenHash }}` interpolates into the email) and completing the real
  `/auth/confirm?token_hash=...&type=email` request with `curl` — same
  route, same `verifyOtp` call, same cookie plumbing a browser would use.
  `auth.users.last_sign_in_at`, previously `null`, is now set, which is the
  clearest proof the flow works end to end. Confirmed `type=email` is the
  correct OTP type for this route (matches what the already-fixed "Magic
  Link" template sends).
  - Every API route exercised with a real authenticated session: account
    CRUD, lot CRUD (incl. delete), CSV import (incl. malformed-row
    handling), `record_sell` RPC (real FIFO consumption across two trades,
    not just unit-tested), settings GET/POST round-trip, Yahoo quote
    refresh, digest GET/POST (real Claude call + cache), sale delete, and
    proxy redirect behavior both directions (unauth → `/login`,
    post-signout → `/login`).
  - Wash-sale engine verified against real DB-backed data (not just unit
    tests): a sell-side IRA-permanent case, a sell-side deferred
    cross-account case, a sell-side case correctly *not* flagged (buy
    outside the 61-day window), and both IRA/non-IRA flavors of the buy-side
    "buy-after-loss" case.
  - `tsc`/`eslint`/50 unit tests still clean after the run; Supabase
    security+performance advisors re-checked — only pre-existing, by-design
    items (the intentionally-unrestricted `quotes` INSERT/UPDATE policy;
    leaked-password-protection, which is moot since this app has no
    passwords) plus informational unused-index notices from having just
    started real traffic.
  - A demo dataset was seeded through the app's own API (not raw SQL) as
    part of this verification and left in place: 4 accounts (2 taxable, 1
    Roth, 1 traditional IRA), holdings weighted so Information Technology
    sits ~56–65% of the portfolio (trips the concentration flag both before
    and after the demo trades), and 3 recorded sales realizing the wash-sale
    scenarios above.
- **Still not verified:** clicking an actual emailed magic link in a real
  browser. The MCP-token approach reproduces the PKCE flow faithfully but
  never opens an inbox — that's the last real-world confirmation, and it's
  dashboard/manual-only (see below).

## The 4-phase roadmap to production readiness

1. **Make it hostable at all** (multi-user auth + hosted DB + deploy) —
   **Closed**, modulo one manual step only doable from the Supabase
   dashboard: the "Confirm signup" email template (see below). Everything
   else — auth, RLS, every API route, the wash-sale/concentration engines
   against real data, the Claude digest — is verified end to end as of
   2026-07-31.
2. **Cut onboarding friction** — SnapTrade brokerage sync so holdings and
   transactions import automatically instead of manual entry/CSV. Not
   started.
3. **Trust & polish** — error tracking (Sentry), rate-limit the digest
   endpoint, and (if SnapTrade lands) encrypt stored brokerage tokens plus a
   real privacy policy/ToS. Not started.
4. **Get users** — a landing/waitlist page pitching the cross-account
   wash-sale angle; direct outreach in DIY-investor communities (Bogleheads,
   r/personalfinance, r/investing) rather than paid ads. Not started.

## Two things only the dashboard can fix (not doable via MCP or code)

1. **Authentication → Email Templates → "Confirm signup"** is still on the
   default `{{ .ConfirmationURL }}` (implicit flow, drops the token in a URL
   fragment the server never sees). Change its link to
   `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">`,
   matching the already-fixed "Magic Link" template. This only affects
   *brand-new* signups — the existing user account is past it, which is why
   the automated run above couldn't catch it.
2. **Authentication → URL Configuration → Additional Redirect URLs** —
   confirm both `http://localhost:3000/auth/confirm` and
   `https://ledger-check-henna.vercel.app/auth/confirm` are listed.

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