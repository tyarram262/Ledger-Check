@AGENTS.md
# Session handoff — READ THIS FIRST (updated 2026-08-02)

Two layers below this one: **"Mission & how to work here"** (the north
star — how to think about features and write code in this repo) and
**"Domain logic reference"** (the two IRS/concentration rules that must
stay exactly right). Everything else from prior spec documents has been
folded into this handoff section or cut as redundant — see git history
if you need the original prose back.

## Actual tech stack

- **Next.js 16** (App Router, TypeScript, Tailwind), single full-stack app
  on **Supabase** (Postgres + RLS + passwordless magic-link auth) —
  no separate backend service, no Redis, no SnapTrade yet, no shadcn/ui
  (hand-rolled Tailwind throughout). The mission doc below originally
  envisioned FastAPI/Python/Redis/shadcn; that's aspirational, not a
  migration directive (explicit user decision, 2026-08-02) — this stack
  stays.
- **Deployed on Vercel**, project `atls4/ledger-check`, production URL
  `https://ledger-check-henna.vercel.app`. GitHub repo
  `tyarram262/Ledger-Check` auto-deploys on push to `main`.
- AI digest calls **Claude** (`claude-haiku-4-5` via `@anthropic-ai/sdk`)
  directly — not an OpenAI-compatible abstraction layer (a real gap
  against the AI-philosophy principle below if multi-provider ever
  matters; a reasonable simplification for now).
- Holdings/sales are entered manually or via CSV — no brokerage sync yet
  (Phase 2 of the roadmap below).
- **Next.js 16 renamed `middleware.ts` → `proxy.ts`** (exported fn is
  `proxy`, not `middleware` — `src/proxy.ts`). This Next.js version is
  newer than most training data; verify anything Next.js-specific against
  `node_modules/next/dist/docs/` rather than assuming.
- This Mac can't build native npm modules (no working Xcode CLT) — keep
  preferring pure-JS/WASM deps.

## Database (Supabase Postgres — no local migrations folder)

Schema is applied directly via the Supabase MCP `apply_migration` tool,
not checked into the repo. Inspect it live (`mcp__supabase__list_tables` /
`execute_sql`), don't look for `supabase/migrations/`.

- `accounts` (incl. `cash_balance`), `lots`, `sales`, `settings` (incl.
  tax-profile columns), `digest_cache`, `health_snapshots` — each has
  `user_id uuid references auth.users(id) default auth.uid()`, RLS
  enabled, policies scoped to `(select auth.uid()) = user_id`.
- `quotes` — shared price cache, deliberately **not** user-scoped; any
  authenticated user can read/write (non-sensitive, avoids needing a
  service-role key anywhere).
- `record_sell(...)` — a `SECURITY INVOKER` Postgres function doing atomic
  FIFO lot consumption + sale insert, called via `supabase.rpc(...)` from
  `recordTrade.ts` (supabase-js has no client-side transaction API).
- **No `SUPABASE_SERVICE_ROLE_KEY` anywhere, by design.** Every RLS policy
  is written so the user's own session is sufficient. Don't introduce it
  unless a genuine admin-only operation requires it.

## Auth flow (working end to end as of 2026-07-31)

- `src/proxy.ts` + `src/lib/supabase/proxy.ts` gate every route except
  `/login` and `/auth/*`.
- `login/actions.ts` derives `emailRedirectTo` from the request's `Origin`
  header so one Supabase project serves both localhost and prod (Supabase
  only has one `Site URL`).
- Two email templates matter: Supabase's **"Confirm signup"** (new
  address) and **"Magic Link"** (returning). Both use PKCE-style links
  (`?token_hash={{ .TokenHash }}&type=email`). Editing a template requires
  custom SMTP configured first.
- **Custom SMTP is live via Resend** (`smtp.resend.com:465`, sender
  `onboarding@resend.dev`). **Known limitation:** Resend sandbox mode only
  delivers to the exact email the account was created with —
  **`tanush.yarram@gmail.com`**. Every other address gets a hard `550`.
  Fix: verify a domain on Resend (see roadmap below) — not urgent for
  single-user use.
- Supabase Dashboard → Authentication → URL Configuration → Additional
  Redirect URLs needs both the localhost and prod `/auth/confirm` URLs.
  No MCP tool covers Auth/SMTP config — dashboard-only, user must do it.

## What's built vs. the mission doc's 5-feature MVP

| Feature (mission doc) | Status | Notes / gap |
|---|---|---|
| **1. Portfolio Import** | CSV + manual entry done (`/holdings`, `csvImport.ts`) | No `BrokerageProvider` abstraction yet — `queries.ts` talks to Supabase directly. Natural point to add it: Phase 2 (SnapTrade) below, not before. |
| **2. Trade Check** | Concentration, sector, ETF overlap, diversification impact, overall score all live (`/simulate`, `simulate.ts`, `etfOverlap.ts`, `scores.ts`) | Missing: estimated volatility impact (no return-series data source), position sizing, behavioral warnings. |
| **3. Tax Check** | Wash sale, short/long-term gains, estimated realized gain/loss all live (`washSale.ts`, `holdingPeriod.ts`, `taxCheck.ts`) | Lot selection is FIFO-only (matches "future" scope in mission doc). Every tax figure is labeled "estimate only." |
| **4. Portfolio Health** | 5 of 6 sub-scores live and daily-persisted (`scores.ts`, `/api/health`): Diversification, Concentration, Sector Balance, Tax Efficiency, Cash Allocation | Risk exists only as a per-trade score in Trade Check, not a 6th daily sub-score — small follow-up (`riskScore` → `computeAndPersistHealth`). **No sub-score renders an actionable recommendation yet**, only a descriptive sentence — needs a product call on how prescriptive to get without crossing into "AI makes buy/sell decisions." |
| **5. Investment Journal** | Not started | Needs a new RLS-scoped table + a prompt step in the buy flow (`LotForm.tsx`) + surfacing back in `HoldingsTable.tsx` or fed into the Claude digest. |

Trade Check / Tax Check / Portfolio Health shipped 2026-08-02: ETF
look-through overlap (`etfOverlap.ts` + `src/data/etf-holdings.json`,
static top-holdings snapshot for 24 ETFs — flags near-duplicate funds and
"true" exposure through funds you hold), a long-term-gain countdown
("wait N days, save ~$X" — no broker surfaces this), and IRA sells
returning **zeroed tax figures with an explanation, never a fabricated
number**. Tax efficiency is computed from **unrealized** lot data only —
`sales` has no acquisition date, so realized short/long-term can't be
reconstructed without a schema + `record_sell` change. Schema additions:
`accounts.cash_balance`, `settings.{filing_status,annual_taxable_income,
state_tax_rate}`, `health_snapshots` (migration
`mvp_cash_tax_profile_health`).

The AI-philosophy example sentences below ("You already own similar
exposure through QQQ") are **already produced deterministically**, not by
an LLM — `etfOverlap.ts` and `concentration.ts` generate near-verbatim
variants. `digest.ts` is the one actual AI call in the app and only
narrates numbers computed elsewhere.

## Verification log

**Phase 1 / auth (verified 2026-07-31, real browser):** Full authenticated
pass against live Supabase — real signup email clicked, every API route
exercised with a real session (CRUD, CSV import, `record_sell` FIFO RPC,
settings, quote refresh, digest), wash-sale engine checked against real
DB-backed data (IRA-permanent, deferred cross-account, correctly-not-
flagged, both buy-after-loss flavors). `tsc`/`eslint`/50 tests clean.

**MVP features (2026-08-02): unit-tested, not yet browser-verified.** 131
tests passing (117 new), `tsc`/`eslint`/`next build` clean, Supabase
advisors clean, prod curl-verified live (`/` → 307 to `/login`, `/login`
→ 200). **No authenticated click-through was possible this session** (no
stored browser session, no inbox access for the magic-link email).
**Next person: sign in as `tanush.yarram@gmail.com` and click through the
health score, the trade-check panels, the tax-check panel (incl. the IRA
zero-tax case), and the settings tax-profile form before trusting the UI
layer** — logic is solid, rendering hasn't been looked at with real eyes.

Demo data exists under `tanush.yarram@gmail.com` (**use this one** — the
only address Resend's sandbox can currently email) and, separately, an
older copy under `tanush.yarram@icloud.com` (unreachable until a Resend
domain is verified). Both: 4 accounts spanning taxable/Roth/traditional-
IRA, holdings weighted so Information Technology trips the concentration
threshold, sales realizing IRA-permanent + deferred + buy-after-loss
wash-sale scenarios.

## The 4-phase roadmap to production readiness

1. **Hostable at all** (auth + hosted DB + deploy) — **closed 2026-07-31.**
   Caveat carried forward: Resend sandbox mode limits which address can
   receive auth emails — fix by verifying a domain, worth bundling with
   Phase 4.
2. **Cut onboarding friction** — SnapTrade brokerage sync, replacing
   manual/CSV entry. Not started.
3. **Trust & polish** — Sentry, rate-limit the digest endpoint, encrypt
   brokerage tokens (once Phase 2 lands) + a real privacy policy/ToS. Not
   started.
4. **Get users** — landing/waitlist page pitching the cross-account
   wash-sale angle; DIY-investor communities over paid ads. Not started.

---

# Mission & how to work here (north star)

## Mission

Ledger Check is an AI-powered pre-trade decision assistant for
self-directed retail investors — the **"Grammarly for Investing."** Not
another brokerage, not another portfolio tracker.

Every feature answers one question: **"Will this help an investor make a
better decision BEFORE they trade?"** A feature that only shows historical
information without informing a future decision — challenge whether it
belongs.

## Product principles

1. Prevent expensive mistakes.
2. Explain WHY something matters.
3. Keep recommendations transparent.
4. **Never make buy/sell decisions.**
5. Help users think instead of replacing them.

Decision-support, not an autonomous investment advisor.

## Target users

Self-directed retail investors, $10k–$2M portfolios. Robinhood/Fidelity/
Schwab/IBKR/Webull. Own ETFs and individual stocks. Understand investing
basics; don't understand taxes, portfolio overlap, or concentration risk.

## Design philosophy

Every page answers one of three questions: **How healthy is my
portfolio? Should I make this trade? What changed?** Avoid unnecessary
dashboards and information overload.

## AI philosophy

The AI behaves like a calm fiduciary-style reviewer that **challenges
assumptions** — "You already own similar exposure through QQQ," "This
increases technology allocation from 28% to 42%," "This sale may trigger
a wash sale," "This position becomes your largest holding." Never "Buy
this," "Sell this," "This stock will outperform." Avoid predictions.

## Engineering principles & coding standards

Clean, modular, readable over clever. Strong typing, reusable components,
no duplicated business logic. Separate UI / business logic / financial
calculations / AI prompting / API layer.

Always: write tests for business logic, document financial calculations,
descriptive names, validate inputs, typed return objects.

Never: hardcode financial assumptions, mix UI with business logic, put
financial calculations inside prompts, hide calculations from users.

**Financial calculations must never rely on AI — LLMs explain results,
deterministic code computes them.** (Fully honored today: every
score/warning — `washSale.ts`, `taxCheck.ts`, `scores.ts`,
`etfOverlap.ts` — is deterministic; `digest.ts` is the only AI call and
only narrates numbers computed elsewhere.)

## MVP scope

Five features, build in this order — status of each is in "What's built"
above:

1. **Portfolio Import** — CSV + manual entry; design so brokerage APIs
   (Plaid, SnapTrade) can be added later without a rewrite.
2. **Trade Check** — ticker/shares/buy-or-sell in → concentration
   warning, sector allocation change, ETF overlap, diversification
   impact, estimated volatility impact, allocation after trade, overall
   trade health score.
3. **Tax Check** — wash-sale risk, short vs. long-term gains, estimated
   realized gain/loss, tax-lot selection (future). Never estimate taxes
   without clearly labeling assumptions.
4. **Portfolio Health** — Diversification, Sector Balance, Concentration,
   Tax Efficiency, Cash Allocation, Risk. Each score needs an actionable
   recommendation, not just a number.
5. **Investment Journal** — on purchase, ask why you're buying, your time
   horizon, what would make you sell, what risks concern you. Save it,
   reference it later.

## Future vision

Ledger Check eventually becomes the operating system for self-directed
investors: brokerage integrations, options analysis, tax-loss harvesting,
a rebalancing engine, portfolio drift detection, dividend forecasting, AI
portfolio review, advisor/CPA dashboards. **Don't build these until the
MVP demonstrates product-market fit.**

## Success metric

A successful user journey: opens Ledger Check before every trade →
understands the tradeoffs → makes a more informed decision → trusts it
enough to make it part of every investing workflow. Every new feature
should move one of these; if it doesn't, question whether it belongs.

---

# Domain logic reference (still authoritative)

**IRS wash-sale rule (26 U.S.C. §1091):**
- Window: 30 days before + day of + 30 days after a loss sale (61 days
  total). "Substantially identical" = **same ticker only** for now —
  don't attempt cross-ticker detection (e.g. VOO vs. SPY); flag it as a
  known UI limitation instead.
- Applies across **every account the same taxpayer owns**, including
  IRAs (no spousal accounts for now).
- **Rev. Rul. 2008-5:** if the repurchase happens in an IRA, the loss is
  **permanently disallowed**, not deferred into a higher cost basis like
  a normal wash sale — materially worse, and the case brokers are worst
  at catching. Must be distinguished and flagged specifically.

**Sector concentration:** % of total portfolio value by sector (ticker →
sector mapping, cache it, flag unmapped tickers rather than guessing).
Simulate a proposed trade and show before/after allocation, flagging any
sector over a user-configurable threshold (default 25%).

**Explicit non-goals:** no trade execution (read/simulate only), no
"tax advice" framing anywhere in copy, no spousal accounts/multi-currency/
non-US tax rules, no cross-ticker "substantially identical" detection,
no multi-user/team features.
