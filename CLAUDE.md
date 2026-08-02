@AGENTS.md
# Session handoff — READ THIS FIRST (updated 2026-08-02)

Three layers below, in order: this handoff section (operational reality —
read it first), then a **product mission/principles doc** (the north star —
added 2026-08-02, aspirational in places, flagged where it diverges from
what's actually built), then the **original build prompt** (old spec —
still authoritative for the domain-logic sections it covers: wash-sale
rules, sector concentration; everything else in it is superseded by the
mission doc or this handoff section).

**Tech stack, data model, and API endpoint sections in the old build
prompt are stale** — the user confirmed early on to keep the stack that
actually got built and fill gaps against the spec, rather than rewrite to
match it. That decision was reaffirmed 2026-08-02 when the new mission doc
below specified a different backend (FastAPI/Python/Redis) — see "Note on
the Architecture section below" for why it stays aspirational, not a
migration directive.

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

## MVP feature set: Trade Check, Tax Check, Portfolio Health Score (added 2026-08-02)

Built on top of the wash-sale/concentration engines above, not a rewrite.
User's explicit framing: "forget AI agents, forget autonomous investing,
build something people can trust" — every score here is deterministic and
explainable (no LLM in this path; the Claude digest in `digest.ts` is
separate free-text prose, unchanged).

- **Trade Check** (`/simulate`, `simulate.ts` → `SimulationResult`) —
  existing concentration/sector-impact output plus:
  - **ETF look-through overlap** (`etfOverlap.ts` + `src/data/etf-holdings.json`)
    — a hand-curated, static top-~10-25-holdings snapshot for the 24 known
    ETFs (empty + a `note` for funds we can't decompose: AGG/BND/GLD bonds
    &amp; gold, IWM small-cap, VEA/VXUS/VWO international). Computes "true"
    look-through exposure to the traded ticker and flags near-duplicate
    funds you already hold (e.g. buying VOO while holding SPY).
  - **Diversification/risk score deltas** (`scores.ts`) — before/after,
    shown in `ScoreDeltaPanel`.
- **Tax Check** (sell side of `/simulate`, `taxCheck.ts`) — reuses
  `checkWashSale` verbatim, adds:
  - Short/long-term classification per consumed lot (`holdingPeriod.ts`,
    the >365-day IRS rule), a short-term-gain warning, and a **long-term
    countdown** ("wait N days, save ~$X") — the standout feature, since no
    broker surfaces this well.
  - Estimated tax (`taxRates.ts` — 2026 federal brackets + NIIT, verified
    against current sources during implementation, not recalled from
    memory) combined with a user-set filing status/income/state-rate
    profile from `/settings`.
  - **IRA sells return zeroed tax figures with an explanation, never a
    fabricated number** — a Roth/traditional-IRA sell has no current-year
    tax consequence, and this was a deliberate trust-preserving call.
- **Portfolio Health Score** (dashboard, `/api/health` → `health.ts` →
  `scores.ts`) — five sub-scores (Diversification, Concentration, Sector
  balance, Tax efficiency, Cash allocation) rolled into an overall A–F
  grade, each with a plain-English sentence. Persisted once/day in
  `health_snapshots` (upserted on `user_id, snapshot_date`, so repeat loads
  the same day update rather than duplicate) for a trend sparkline.
  - **Tax efficiency is computed from unrealized lot data only** — the
    `sales` table has no acquisition date, so realized short/long-term
    can't be reconstructed retroactively. Deliberate, not a gap to fix
    without a `sales` schema change (which would also touch the
    `record_sell` RPC).

**Schema additions** (migration `mvp_cash_tax_profile_health`, applied
2026-08-02): `accounts.cash_balance`; `settings.filing_status` /
`annual_taxable_income` / `state_tax_rate`; new `health_snapshots` table
(RLS-scoped like every other per-user table, `(select auth.uid()) = user_id`
on select/insert/update, following the same pattern as `settings`). No
`sales` schema change — see tax-efficiency note above.

**117 new unit tests** (131 total) across `holdingPeriod.test.ts`,
`taxRates.test.ts`, `taxCheck.test.ts`, `etfHoldings.test.ts`,
`etfOverlap.test.ts`, `scores.test.ts`, plus extensions to
`simulate.test.ts`/`washSale.test.ts`. `tsc`/`eslint`/`next build` all
clean; Supabase advisors show no new issues from the migration.

**Deployed**: pushed to `main` (commit `9eac45b`, plus 4 previously-unpushed
Phase 1 commits that went out in the same push) — Vercel auto-deploy
confirmed live via `curl -I https://ledger-check-henna.vercel.app/`
(307 → `/login`) and `/login` (200) at 2026-08-02 ~20:04 UTC.

**Not yet verified: no real authenticated browser pass on these features.**
Unlike Phase 1's auth work (verified with a real signup, inbox, and clicked
link), this session had no way to complete a magic-link click-through —
verification stopped at unit tests + `next build` + a curl-level check that
the unauthenticated proxy redirect still works. **Whoever reads this next
should sign in as `tanush.yarram@gmail.com` and click through the health
score, the trade-check panels (overlap, score deltas), the tax-check panel
(short-term warning, long-term countdown, estimated tax, the IRA
zero-tax case), and the settings tax-profile form before trusting the UI
layer** — the domain logic is unit-tested solid, but nothing above has been
looked at with real eyes yet.

## Verified vs. not yet verified — Phase 1 / auth (as of 2026-07-31)

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

# Product mission & principles (north star, added 2026-08-02)

The user's framing: choose whichever version gives this the best real
chance at users and profitability. This doc is that version — kept in
full below, with two editorial notes (marked **[HANDOFF NOTE]**) tying it
back to what's actually built, so it doesn't silently drift from reality
the way the old build prompt did.

## Mission

Ledger Check is an AI-powered pre-trade decision assistant for self-directed retail investors.

We are NOT building another brokerage.

We are NOT building another portfolio tracker.

We are building the "Grammarly for Investing."

Every feature should answer one question:

"Will this help an investor make a better decision BEFORE they trade?"

If a feature only shows historical information without helping future decisions, challenge whether it belongs in the MVP.

---

# Product Principles

Prioritize:

1. Prevent expensive mistakes.
2. Explain WHY something matters.
3. Keep recommendations transparent.
4. Never make buy/sell decisions.
5. Help users think instead of replacing them.

Ledger Check is a decision-support tool.

It is NOT an autonomous investment advisor.

---

# Target Users

Primary:

Self-directed retail investors with portfolios between $10k-$2M.

Typical characteristics:

- Uses Robinhood, Fidelity, Schwab, Interactive Brokers, or Webull.
- Owns ETFs and individual stocks.
- Wants long-term wealth building.
- Understands investing basics.
- Does not understand taxes, portfolio overlap, or concentration risk.

---

# Core Value Proposition

Before making a trade, users should receive an instant "Ledger Check."

Example:

User:

"I want to buy 20 shares of NVIDIA."

Ledger Check should analyze:

- Concentration impact
- Sector exposure
- ETF overlap
- Diversification impact
- Tax implications
- Risk changes
- Position sizing
- Behavioral warnings

The app should explain these clearly.

Never simply output a score.

**[HANDOFF NOTE]** Concentration impact, sector exposure, ETF overlap,
diversification impact, risk changes, and an overall trade-health score
delta are all live today — see "MVP feature set" above (`simulate.ts`,
`etfOverlap.ts`, `scores.ts`, rendered via `ScoreDeltaPanel`/`OverlapPanel`
on `/simulate`). Tax implications are live via the separate Tax Check flow
on the sell side. Position sizing and behavioral warnings are not built —
candidates for next iteration.

---

# MVP

Build ONLY these features first.

## Feature 1

Portfolio Import

Support:

- CSV
- Manual entry

Design architecture so brokerage APIs (Plaid, SnapTrade, etc.) can be added later.

**[HANDOFF NOTE]** CSV + manual entry both exist (`/holdings`,
`csvImport.ts`). The "design for pluggable brokerage APIs later" part is
**not** done — there's no `BrokerageProvider`-style interface; `queries.ts`
talks to Supabase directly. SnapTrade integration is Phase 2 of the
roadmap below and would be the natural point to introduce that
abstraction, not before it's needed.

---

## Feature 2

Trade Check

Inputs:

Ticker

Shares

Buy/Sell

Outputs:

- Concentration warning
- Sector allocation changes
- ETF overlap
- Diversification impact
- Estimated volatility impact
- Portfolio allocation after trade
- Overall trade health score

**[HANDOFF NOTE]** All live except "estimated volatility impact" (no
price-history/beta data source exists yet — `quotes.ts` only stores a
current price, not a return series).

---

## Feature 3

Tax Check

Detect:

- Wash sale risk
- Short vs long-term capital gains
- Estimated realized gain/loss
- Tax lot selection (future)

Never estimate taxes without clearly labeling assumptions.

**[HANDOFF NOTE]** All live (`washSale.ts`, `holdingPeriod.ts`,
`taxCheck.ts`). Lot selection is FIFO-only, matching "tax lot selection
(future)" being explicitly out of scope for now. Every tax figure in the
UI carries an "estimate only — not tax advice" label per the "never
estimate without labeling assumptions" rule here.

---

## Feature 4

Portfolio Health

Generate scores for:

Diversification

Sector Balance

Concentration

Tax Efficiency

Cash Allocation

Risk

Each score must include actionable recommendations.

**[HANDOFF NOTE]** The five daily-persisted sub-scores
(Diversification/Concentration/Sector Balance/Tax Efficiency/Cash
Allocation — `scores.ts`, `/api/health`) match this list exactly. Risk is
currently a per-trade score inside Trade Check, not a sixth daily
sub-score on the health card — folding it in would just mean calling
`riskScore` from `computeAndPersistHealth` in `health.ts` and adding a
6th weight to `HEALTH_SCORE_WEIGHTS`, a small follow-up. **Gap:** none of
the six sub-scores currently render an "actionable recommendation," only
a descriptive sentence (e.g. "38% of your portfolio is in Information
Technology — that's elevated concentration"). Turning each sentence into
a specific recommendation ("consider trimming X by $Y to get under Z%")
is unbuilt and would need product decisions about how prescriptive to be
without crossing into "AI makes buy/sell decisions."

---

## Feature 5

Investment Journal

When purchasing an investment:

Ask:

- Why are you buying?
- What is your time horizon?
- What would make you sell?
- What risks concern you?

Save these.

Reference them later.

**[HANDOFF NOTE]** Not started. Would need a new table (journal entries
keyed to a lot or a ticker+account, RLS-scoped like every other table
here) and a step in the buy flow (`LotForm.tsx` / `recordTrade.ts`)
prompting for these four answers, plus somewhere to surface them back —
natural fit next to a position in `HoldingsTable.tsx` or as context fed
into the Claude digest (`digest.ts`) so the AI summary can reference the
user's own stated thesis ("you said you were buying for a 5-year horizon;
you're now 8 months in").

---

# Design Philosophy

Every page should answer one of three questions.

1.

How healthy is my portfolio?

2.

Should I make this trade?

3.

What changed?

Avoid unnecessary dashboards.

Avoid information overload.

---

# AI Philosophy

The AI should behave like a calm fiduciary-style reviewer.

It should challenge assumptions.

Examples:

"You already own similar exposure through QQQ."

"This increases technology allocation from 28% to 42%."

"This sale may trigger a wash sale."

"This position becomes your largest holding."

Never:

"Buy this."

"Sell this."

"This stock will outperform."

Avoid predictions.

**[HANDOFF NOTE]** The ETF-overlap sentence generator in `etfOverlap.ts`
already produces almost exactly the first example verbatim ("You already
hold AAPL indirectly through QQQ..."), and the concentration verdict in
`concentration.ts` produces close variants of the second and fourth. These
are deterministic, not AI-generated — matches the broader principle below
that financial calculations must never live inside a prompt. The Claude
digest (`digest.ts`) is the one place actual AI prose ships today, and its
prompt already avoids buy/sell/outperform framing — worth a deliberate
audit against this "never" list next time it's touched.

---

# Engineering Principles

Write clean, modular code.

Prefer readability over cleverness.

Strong typing.

Reusable components.

No duplicated business logic.

Separate:

UI

Business Logic

Financial Calculations

AI Prompting

API Layer

---

# Architecture

Frontend

Next.js

React

TypeScript

Tailwind

shadcn/ui

Backend

FastAPI

Python

PostgreSQL

Redis

AI

OpenAI-compatible abstraction layer.

Never tightly couple to one LLM provider.

Financial calculations should NOT rely on AI.

LLMs explain results.

Deterministic code computes results.

**[HANDOFF NOTE] Note on the Architecture section above: this stays
aspirational, not a migration directive** (explicit user decision,
2026-08-02). What's actually running: Next.js 16 full-stack (App Router,
TypeScript, Tailwind — no shadcn/ui component library adopted, everything
is hand-rolled Tailwind, see "Shared UI components" pattern), Supabase
Postgres for both the database and auth (no separate FastAPI/Python
service, no Redis — see "Actual tech stack" at the top of this file for
the full, current picture and why it diverged from every prior spec
including this one). The AI layer is tied directly to Anthropic's SDK
(`@anthropic-ai/sdk`, not an OpenAI-compatible abstraction) — a real gap
against "never tightly couple to one LLM provider" if multi-provider
support ever becomes a priority, but a reasonable simplification for a
single-model MVP. "Financial calculations should NOT rely on AI, LLMs
explain results" is fully honored: every score/warning in this codebase
(`washSale.ts`, `taxCheck.ts`, `scores.ts`, `etfOverlap.ts`) is
deterministic; `digest.ts` is the only AI call and it only narrates
numbers computed elsewhere, never computes them itself.

---

# Coding Standards

Always:

Write tests for business logic.

Document financial calculations.

Use descriptive names.

Validate user inputs.

Return typed objects.

Never:

Hardcode financial assumptions.

Mix UI with business logic.

Put financial calculations inside prompts.

Hide calculations from users.

---

# Future Vision

Ledger Check eventually becomes the operating system for self-directed investors.

Future modules:

- Brokerage integrations
- Options analysis
- Tax-loss harvesting
- Rebalancing engine
- Portfolio drift detection
- Dividend forecasting
- AI portfolio review
- Advisor dashboard
- CPA dashboard

Do not implement these until the MVP demonstrates product-market fit.

---

# Success Metric

A successful user journey is:

1. User opens Ledger Check before every trade.
2. User understands the tradeoffs.
3. User makes a more informed decision.
4. User trusts Ledger Check enough to make it part of every investing workflow.

Every new feature should increase one of these outcomes.

If it doesn't, question whether it belongs.

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