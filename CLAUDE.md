@AGENTS.md
# Session handoff — READ THIS FIRST (updated 2026-08-02, evening)

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
  tax-profile columns), `digest_cache`, `health_snapshots` (incl. `risk`),
  `journal_entries` — each has
  `user_id uuid references auth.users(id) default auth.uid()`, RLS
  enabled, policies scoped to `(select auth.uid()) = user_id`.
- `quotes` — shared price cache, deliberately **not** user-scoped; any
  authenticated user can read/write (non-sensitive, avoids needing a
  service-role key anywhere).
- `record_sell(...)` — a `SECURITY INVOKER` Postgres function doing atomic
  FIFO lot consumption + sale insert, called via `supabase.rpc(...)` from
  `recordTrade.ts` (supabase-js has no client-side transaction API). It
  **hard-deletes** a lot once fully consumed — load-bearing for
  `journal_entries`' schema design, see below.
- **No `SUPABASE_SERVICE_ROLE_KEY` anywhere, by design.** Every RLS policy
  is written so the user's own session is sufficient. Don't introduce it
  unless a genuine admin-only operation requires it.

## Auth flow (working end to end as of 2026-08-03)

- `src/proxy.ts` + `src/lib/supabase/proxy.ts` gate every route except
  `/login` and `/auth/*`.
- `login/actions.ts` derives `emailRedirectTo` from the request's `Origin`
  header so one Supabase project serves both localhost and prod (Supabase
  only has one `Site URL`) — now hard-fails with a user-facing error if
  `Origin` is missing, rather than silently falling back to Site URL.
- Two email templates matter: Supabase's **"Confirm signup"** (new
  address) and **"Magic Link"** (returning). Both use PKCE-style links.
  **Both must render `{{ .RedirectTo }}`, not `{{ .SiteURL }}`** —
  `.SiteURL` ignores `emailRedirectTo` entirely and always resolves to the
  project's single configured Site URL, which is what caused prod sign-ins
  to land on `localhost` (fixed 2026-08-03). Template link shape:
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`. Editing a
  template requires custom SMTP configured first.
- **Custom SMTP is live via Resend** (`smtp.resend.com:465`, sender
  `onboarding@resend.dev`). **Known limitation:** Resend sandbox mode only
  delivers to the exact email the account was created with —
  **`tanush.yarram@gmail.com`**. Every other address gets a hard `550`.
  Fix: verify a domain on Resend (see roadmap below) — not urgent for
  single-user use.
- Supabase Dashboard → Authentication → URL Configuration needs **Site
  URL** set to the prod domain, plus both the localhost and prod
  `/auth/confirm` origins in Additional Redirect URLs (wildcarded, e.g.
  `https://ledger-check-henna.vercel.app/**`). No MCP tool covers
  Auth/SMTP/template config — dashboard-only, user must do it.
- **2026-08-03: discarded, not committed** — a local edit had replaced the
  magic-link form (`src/app/login/page.tsx`) with an auto-firing
  `supabase.auth.signInAnonymously()` guest session, plus a `layout.tsx`
  tweak to label anonymous sessions. Reverted: anonymous sign-ins aren't
  enabled in Supabase, every anonymous session mints a fresh `auth.uid()`
  (orphaning the demo portfolio under RLS), and it didn't address the
  localhost-redirect bug anyway. If a demo/guest mode is ever wanted, it
  belongs behind an explicit opt-in button, not as the default `/login`
  behavior.

## What's built vs. the MVP (current numbering, 2026-08-02)

Portfolio Import is the foundation everything else sits on, not one of the
"5" below anymore — it's done and unremarkable enough to not need its own
slot. The 5 features are Trade Check / Tax Check / Portfolio Health / AI
Trade Review / Investment Journal, in build order — see "MVP scope" below
for the full spec each row is measured against. **All 5 are now live.**

| Feature | Status | Notes / gap |
|---|---|---|
| **Portfolio Import** (prerequisite) | Done | CSV + manual entry (`/holdings`, `csvImport.ts`). No `BrokerageProvider` abstraction yet — `queries.ts` talks to Supabase directly. Natural point to add it: Phase 2 (SnapTrade) below, not before. |
| **1. Trade Check** | Live | Concentration, sector, ETF overlap, diversification/risk score deltas, overall verdict all live (`/simulate`, `simulate.ts`, `etfOverlap.ts`, `scores.ts`). Missing: estimated volatility impact (no return-series data source), position sizing, behavioral warnings. |
| **2. Tax Check** | Live | Wash-sale warning, short-term gain warning, long-term gain countdown, estimated tax all live (`washSale.ts`, `holdingPeriod.ts`, `taxCheck.ts`). Lot selection is FIFO-only (explicitly "future" scope). Every tax figure labeled "estimate only." |
| **3. Portfolio Health Score** | Live | **All 6 sub-scores** live and daily-persisted (`scores.ts`, `/api/health`): Diversification, Concentration, Risk, Sector Balance, Tax Efficiency, Cash Allocation → overall A–F grade. **No sub-score renders an actionable recommendation yet**, only a descriptive sentence — needs a product call on how prescriptive to get without crossing into "AI makes buy/sell decisions." |
| **4. AI Trade Review** | Live | On-demand "second opinion" on `/simulate` (`tradeReview.ts` + `/api/trade-review` + `TradeReviewPanel.tsx`) — a devil's-advocate critique, never a buy/sell call. Stateless (no cache table); reuses the deterministic `SimulationResult` the trade-check panels already show, never computes anything itself. An optional rationale textarea makes the critique a real second opinion instead of re-narrating what's already on screen. |
| **5. Investment Journal** | Live (v1 scope: capture + display only) | Prompted after a real buy, both the manual-entry (`LotForm.tsx`) and record-trade (`TradeSimulator.tsx`) flows; shown inline per lot in `HoldingsTable.tsx`. **Real gap in the original ask, deliberately not built:** the payoff example ("you said you wouldn't sell unless revenue growth slowed below 15%; it's still 24%") needs *fundamentals* data this app has no source for — `quotes.ts` only stores a current price. V1 instead does an honest, static "this time horizon has closed" line, derived from a structured time-horizon field, with no dashboard-level nudges, dismissal state, or entry editing yet. |

**This session (2026-08-02, evening) added:** AI Trade Review and
Investment Journal (both above), Risk promoted to the 6th daily health
sub-score (`riskScore` now called from `computeAndPersistHealth`, weights
rebalanced, `overall` now divides by a computed weight total instead of a
hardcoded 100), and a bug fix: **`/api/simulate` never fetched the user's
tax profile from `/settings`**, so every Tax Check estimate silently used
the single-filer/$0-income default regardless of what was configured —
fixed via a new shared `tradeContext.ts` (`parseTradeBody` +
`runSimulation`) that both `/api/simulate` and `/api/trade-review` now
call, so this can't drift out of sync between routes again.

**Investment Journal's schema constraint, worth knowing before touching
it:** `record_sell` hard-deletes a lot once fully consumed by a sell, and
the Remove button hard-deletes on request. `journal_entries.lot_id` uses
`on delete set null` (not a plain FK, not cascade) plus a denormalized
ticker/account/shares/cost/purchase-date snapshot, so an entry survives
its lot's lifecycle instead of either breaking the sell or being
destroyed exactly when it becomes most valuable. Verified directly
against the live DB (a scratch insert → full-lot-delete → check → clean
up) before shipping.

Trade Check / Tax Check / Portfolio Health shipped earlier the same day:
ETF look-through overlap (`etfOverlap.ts` + `src/data/etf-holdings.json`,
static top-holdings snapshot for 24 ETFs — flags near-duplicate funds and
"true" exposure through funds you hold) and IRA sells returning **zeroed
tax figures with an explanation, never a fabricated number**. Tax
efficiency is computed from **unrealized** lot data only — `sales` has no
acquisition date, so realized short/long-term can't be reconstructed
without a schema + `record_sell` change. Schema: `accounts.cash_balance`,
`settings.{filing_status,annual_taxable_income,state_tax_rate}`,
`health_snapshots` (migrations `mvp_cash_tax_profile_health`,
`health_snapshots_risk`, `journal_entries`,
`journal_entries_account_id_idx`).

The AI-philosophy example sentences below ("You already own similar
exposure through QQQ") are **already produced deterministically**, not by
an LLM — `etfOverlap.ts` and `concentration.ts` generate near-verbatim
variants. `digest.ts` and `tradeReview.ts` are the only two places that
actually call Claude, and both only narrate/critique numbers computed
elsewhere — never compute anything themselves.

## Verification log

**Phase 1 / auth (verified 2026-07-31, real browser):** Full authenticated
pass against live Supabase — real signup email clicked, every API route
exercised with a real session (CRUD, CSV import, `record_sell` FIFO RPC,
settings, quote refresh, digest), wash-sale engine checked against real
DB-backed data (IRA-permanent, deferred cross-account, correctly-not-
flagged, both buy-after-loss flavors). `tsc`/`eslint`/50 tests clean.

**MVP features (2026-08-02, morning): unit-tested, not yet browser-verified.**
131 tests passing (117 new), `tsc`/`eslint`/`next build` clean, Supabase
advisors clean, prod curl-verified live (`/` → 307 to `/login`, `/login`
→ 200).

**AI Trade Review / Investment Journal / Risk sub-score (2026-08-02,
evening): unit-tested + DB-verified, not yet browser-verified.** 146
tests passing (15 new — `addMonths` boundary cases, `journal.ts`'s
horizon math, a tax-profile regression test), `tsc`/`eslint`/`next build`
clean, Supabase advisors clean. Went further than the morning session on
DB-level verification specifically because this slice touched `ON DELETE`
semantics: ran a real insert → full-lot-delete → check → clean up against
the live database to confirm `journal_entries.lot_id` survives as NULL
rather than erroring or cascading, and curl-smoke-tested that
`/api/journal`, `/api/trade-review`, and `/api/health` all correctly
307-redirect when unauthenticated, same as every existing route.

**No authenticated click-through was possible either session** (no stored
browser session, no inbox access for the magic-link email — a standing
environment limitation, not something that's been tried and failed).
**Next person: sign in as `tanush.yarram@gmail.com` and click through the
health score (now 6 sub-scores), the trade-check panels (incl. the "AI
second opinion" button and rationale textarea), the tax-check panel
(incl. the IRA zero-tax case), the settings tax-profile form, and the
journal prompt on both a manual buy and a recorded simulator trade (incl.
Skip on each) before trusting the UI layer** — logic is solid and the one
DB constraint that mattered has been verified directly, but rendering and
interaction flow haven't been looked at with real eyes.

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
`etfOverlap.ts` — is deterministic; `digest.ts` and `tradeReview.ts` are
the only AI calls, and both only narrate/critique numbers computed
elsewhere.)

## Forget AI agents, forget autonomous investing — build something people trust

The framing behind every version below (user's words, 2026-08-02). v1 is
five deterministic-first features people can verify by hand; only v2 adds
proactive intelligence, and only v3 starts reasoning across all of it
together. Skipping straight to "AI agent that manages your portfolio"
is exactly what this product is not — see AI philosophy above.

## MVP scope (v1) — build in this order

Portfolio Import (CSV + manual entry, done — design so brokerage APIs
like Plaid/SnapTrade slot in later without a rewrite) is the prerequisite
everything below sits on. Status of each feature is in "What's built"
above — **all five are now live.**

1. **Trade Check** — "I want to buy 50 shares of XYZ" in → concentration
   impact, sector exposure, ETF overlap, diversification score, risk
   score.
2. **Tax Check** — before selling: wash-sale warning, short-term gain
   warning, long-term gain countdown, estimated tax. Never estimate
   without clearly labeling assumptions.
3. **Portfolio Health Score** — a daily score, e.g. `Overall: 83,
   Diversification: A, Tax efficiency: B-, Concentration: C, Sector
   balance: B+, Cash allocation: A`. Each score needs an actionable
   recommendation eventually, not just a letter.
4. **AI Trade Review** — instead of "open ChatGPT and paste your
   portfolio," build the prompts in: "Explain why this trade may be a
   mistake," "Challenge my reasoning." An intelligent devil's advocate,
   not an oracle — same never-buy-never-sell constraint as everywhere
   else in this app, just conversational instead of a fixed panel.
5. **Investment Journal** — on purchase, ask why (long-term growth,
   dividend income, value opportunity, ...). Save it. Later, remind the
   user against their own stated thesis. This is the feature most likely
   to create real behavioral trust, because it holds the user accountable
   to themselves, not to the app's opinion.

## Version 2 — once people love the basics, add proactive intelligence

Don't start this until v1 has real users who'd notice if it disappeared.
Each of these is a *push* version of something v1 already computes
on-demand — cheaper to build later than it looks, once v1 exists:

- **Smart alerts** — "Your portfolio is now 42% technology. No action?"
  Passive version of the existing concentration verdict (`concentration.ts`)
  — the new part is a notification surface (no email/push infra exists
  today; would ride on Resend, already wired for auth email, or an
  in-app banner on next login).
- **Duplicate exposure** — "Buying Google? You already own it in VTI,
  VOO, QQQ, SCHG." This *is* `etfOverlap.ts`, just run proactively across
  the whole portfolio instead of only against a trade being simulated —
  the engine already exists, this is a scan-everything wrapper around it.
- **Opportunity alerts** — "$14,000 of unrealized losses could be
  harvested while keeping a similar allocation." The unharvested-loss
  math already lives inside `taxEfficiencyScore` (`scores.ts`) as one
  input to a sub-score; surfacing it as its own dollar-figure alert is
  cheap.
- **Behavioral alerts** — "You've bought the same stock four times after
  it gained >15% in a week." Real gap: needs pattern detection across
  purchase history *and* the price at each purchase relative to the
  days before it — `quotes.ts` only stores the current price, no
  historical series, so this needs either a price-history table or a
  historical-price API added first.
- **Drift detection** — "You wanted 60% VTI, you're now at 48%." Real
  gap: needs a brand-new concept, user-defined *target* allocations
  (by ticker or sector) — nothing in the schema today stores a target,
  only the concentration *threshold* (a ceiling, not a target). Needs a
  new table.

## Version 3 — the Financial Decision Graph (long-term vision)

Once v1 + v2 exist, Ledger Check knows holdings (`lots`/`sales`), taxes
(`taxCheck.ts`/`scores.ts`), goals and conviction (Investment Journal),
diversification (`scores.ts`), and — once v2 lands — behavior and a
rebalancing/drift schedule. Watchlists don't exist yet in any form. Tying
all of it together turns "what should I buy?" into "what's the best next
action for this investor?" — a fundamentally harder question to copy than
a generic chatbot, because it requires the whole graph, not just an LLM.
**Don't build this until v1 demonstrates product-market fit** — same
discipline as every other future-vision item in this doc.

## Revenue model

Staged with the version plan above, not ahead of it:

- **Free** — Portfolio import, health score, basic (passive) warnings.
- **Pro ($10–15/mo)** — Tax analysis, AI trade review, investment journal,
  portfolio overlap, smart alerts (v2).
- **Later** — Advisor version, CPA dashboard, brokerage API access,
  white-label licensing (v3-adjacent, roughly Phase 2-4 of the roadmap
  above).

**No billing infrastructure exists today** — no Stripe, no paywall
gating, no plan/tier concept anywhere in the schema or API layer. Not
needed until v1's five features are real and used; premature to build
before that, per Product Principle 1 (prevent expensive mistakes) applied
to the business itself, not just the user's portfolio.

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
