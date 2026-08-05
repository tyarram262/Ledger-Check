@AGENTS.md
# Session handoff — READ THIS FIRST (updated 2026-08-05)

Two layers below this one: **"Mission & how to work here"** (the north
star — how to think about features and write code in this repo) and
**"Domain logic reference"** (the two IRS/concentration rules that must
stay exactly right). Everything else from prior spec documents has been
folded into this handoff section or cut as redundant — see git history
if you need the original prose back.

## Actual tech stack

- **Next.js 16** (App Router, TypeScript, Tailwind), single full-stack app
  on **Supabase** (Postgres + RLS + passwordless magic-link auth) —
  no separate backend service, no Redis, no shadcn/ui (hand-rolled
  Tailwind throughout). The mission doc below originally envisioned
  FastAPI/Python/Redis/shadcn; that's aspirational, not a migration
  directive (explicit user decision, 2026-08-02) — this stack stays.
- **Deployed on Vercel**, project `atls4/ledger-check`, production URL
  `https://ledger-check-henna.vercel.app`. GitHub repo
  `tyarram262/Ledger-Check` auto-deploys on push to `main`.
- AI digest calls **Claude** (`claude-haiku-4-5` via `@anthropic-ai/sdk`)
  directly — not an OpenAI-compatible abstraction layer (a real gap
  against the AI-philosophy principle below if multi-provider ever
  matters; a reasonable simplification for now).
- Holdings/sales: manual entry, CSV import, and (Phase 2, in progress —
  see roadmap) SnapTrade brokerage sync via the `BrokerageProvider`
  abstraction in `src/lib/brokerage/`.
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
  `journal_entries`' schema design (its `lot_id` uses `on delete set null`
  plus a denormalized snapshot, so an entry survives its lot's lifecycle;
  verified directly against the live DB before shipping).
- **Phase 2 (SnapTrade sync) additions — applied live 2026-08-04.**
  `lots.purchase_date` is now nullable (a synced lot with no
  reconstructable purchase date — see `reconcileLots.ts` — is `null`,
  never a fabricated date); `lots` gained `source`/`external_key` (plain
  `UNIQUE` on `(account_id, external_key)`, **not** a partial index —
  supabase-js's `{ onConflict: "account_id,external_key" }` compiles to
  `ON CONFLICT (account_id, external_key)` with no predicate, which
  Postgres can only resolve against a non-partial unique constraint;
  NULLs still coexist freely since Postgres treats them as distinct);
  new tables `brokerage_connections` and `snaptrade_users` (holds the
  SnapTrade `user_secret` — never select this into a client component or
  log it), both RLS-scoped like every other table; `accounts` gained
  `snaptrade_account_id`/`connection_id`/`sync_source`, same
  plain-`UNIQUE` treatment on `(user_id, snaptrade_account_id)`.
  `record_sell`'s FIFO `ORDER BY` now reads
  `purchase_date asc nulls last, id asc` — confirmed this matches
  `previewFifoSell`'s ordering in `washSale.ts` (Postgres already
  defaulted `ASC` to `NULLS LAST`, so this was a no-op behaviorally, just
  made explicit so the two orderings don't drift apart by accident later).
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
  `onboarding@resend.dev`). The earlier sandbox-mode limitation (only
  `tanush.yarram@gmail.com` could receive auth email) is **fixed as of
  2026-08-03** (per user confirmation) — other addresses can now sign up.
- Supabase Dashboard → Authentication → URL Configuration needs **Site
  URL** set to the prod domain, plus both the localhost and prod
  `/auth/confirm` origins in Additional Redirect URLs (wildcarded, e.g.
  `https://ledger-check-henna.vercel.app/**`). No MCP tool covers
  Auth/SMTP/template config — dashboard-only, user must do it.
- **Don't reintroduce anonymous sign-in on `/login`** — tried and reverted
  2026-08-03 (auto-firing `signInAnonymously()`). Anonymous sign-ins
  aren't enabled in Supabase, and every anonymous session mints a fresh
  `auth.uid()`, orphaning the demo portfolio under RLS. A demo/guest mode
  belongs behind an explicit opt-in button, not as default `/login`
  behavior.

## What's built vs. the MVP (current numbering, 2026-08-02)

Portfolio Import is the foundation everything else sits on, not one of the
"5" below anymore — it's done and unremarkable enough to not need its own
slot. The 5 features are Trade Check / Tax Check / Portfolio Health / AI
Trade Review / Investment Journal, in build order — see "MVP scope" below
for the full spec each row is measured against. **All 5 are now live.**

| Feature | Status | Notes / gap |
|---|---|---|
| **Portfolio Import** (prerequisite) | Done | CSV + manual entry (`/holdings`, `csvImport.ts`), plus the `BrokerageProvider` abstraction (`src/lib/brokerage/`) as of Phase 2 slice 1 — see roadmap below. |
| **1. Trade Check** | Live | Concentration, sector, ETF overlap, diversification/risk score deltas, overall verdict all live (`/simulate`, `simulate.ts`, `etfOverlap.ts`, `scores.ts`). Missing: estimated volatility impact (no return-series data source), position sizing, behavioral warnings. |
| **2. Tax Check** | Live | Wash-sale warning, short-term gain warning, long-term gain countdown, estimated tax all live (`washSale.ts`, `holdingPeriod.ts`, `taxCheck.ts`). Lot selection is FIFO-only (explicitly "future" scope). Every tax figure labeled "estimate only." |
| **3. Portfolio Health Score** | Live | **All 6 sub-scores** live and daily-persisted (`scores.ts`, `/api/health`): Diversification, Concentration, Risk, Sector Balance, Tax Efficiency, Cash Allocation → overall A–F grade. **No sub-score renders an actionable recommendation yet**, only a descriptive sentence — needs a product call on how prescriptive to get without crossing into "AI makes buy/sell decisions." |
| **4. AI Trade Review** | Live | On-demand "second opinion" on `/simulate` (`tradeReview.ts` + `/api/trade-review` + `TradeReviewPanel.tsx`) — a devil's-advocate critique, never a buy/sell call. Stateless (no cache table); reuses the deterministic `SimulationResult` the trade-check panels already show, never computes anything itself. An optional rationale textarea makes the critique a real second opinion instead of re-narrating what's already on screen. |
| **5. Investment Journal** | Live (v1 scope: capture + display only) | Prompted after a real buy, both the manual-entry (`LotForm.tsx`) and record-trade (`TradeSimulator.tsx`) flows; shown inline per lot in `HoldingsTable.tsx`. **Real gap in the original ask, deliberately not built:** the payoff example ("you said you wouldn't sell unless revenue growth slowed below 15%; it's still 24%") needs *fundamentals* data this app has no source for — `quotes.ts` only stores a current price. V1 instead does an honest, static "this time horizon has closed" line, derived from a structured time-horizon field, with no dashboard-level nudges, dismissal state, or entry editing yet. |

A few facts worth knowing that aren't obvious from the code:

- ETF look-through overlap (`etfOverlap.ts` + `src/data/etf-holdings.json`,
  a static top-holdings snapshot for 24 ETFs) flags near-duplicate funds
  and "true" exposure through funds you already hold. IRA sells return
  **zeroed tax figures with an explanation, never a fabricated number**.
- Tax efficiency is computed from **unrealized** lot data only — `sales`
  has no acquisition date, so realized short/long-term can't be
  reconstructed without a schema + `record_sell` change.
- The `/api/simulate` tax profile bug (fixed 2026-08-02): it never
  fetched the user's `/settings` tax profile, so every Tax Check estimate
  silently used the single-filer/$0-income default. Fixed via a shared
  `tradeContext.ts` (`parseTradeBody` + `runSimulation`) that both
  `/api/simulate` and `/api/trade-review` call, so the two routes can't
  drift out of sync again.
- The AI-philosophy example sentences below ("You already own similar
  exposure through QQQ") are **already produced deterministically**, not
  by an LLM — `etfOverlap.ts` and `concentration.ts` generate near-
  verbatim variants. `digest.ts` and `tradeReview.ts` are the only two
  places that actually call Claude, and both only narrate/critique
  numbers computed elsewhere.

## Verification log

**All v1 features: fully verified as of 2026-08-03**, including a real
authenticated browser click-through on both local and the Vercel
deployment (user-confirmed) — the health score (6 sub-scores), trade-check
panels (incl. AI second opinion + rationale textarea), tax-check panel
(incl. IRA zero-tax case), settings tax-profile form, and the journal
prompt on both manual and recorded-simulator buys. This closes out what
had been the standing gap through 2026-08-02 (unit/DB-tested but never
browser-verified, due to no stored browser session or inbox access in
that environment).

Underlying test/build state as of the last full pass: 146 tests passing,
`tsc`/`eslint`/`next build` clean, Supabase advisors clean. Phase 1 auth
was additionally verified end-to-end against live Supabase on
2026-07-31 (real signup email, every API route with a real session,
wash-sale engine against real DB-backed data). The one DB-level subtlety
worth remembering: `journal_entries.lot_id`'s `on delete set null`
behavior (see Database section above) was confirmed with a real insert →
full-lot-delete → check → clean-up against the live database, not just
assumed from the schema.

Demo data exists under `tanush.yarram@gmail.com` and, separately, an
older copy under `tanush.yarram@icloud.com`. Both: 4 accounts spanning
taxable/Roth/traditional-IRA, holdings weighted so Information Technology
trips the concentration threshold, sales realizing IRA-permanent +
deferred + buy-after-loss wash-sale scenarios.

## The 4-phase roadmap to production readiness

1. **Hostable at all** (auth + hosted DB + deploy) — **closed.** Auth
   verified end-to-end incl. the Resend sandbox limitation (see Auth flow
   above).
2. **Cut onboarding friction** — SnapTrade brokerage sync, replacing
   manual/CSV entry. **Slice 1 (connect + holdings + cash) fully
   live-verified 2026-08-04/05, including a real browser click-through
   (user-confirmed).** Built: `BrokerageProvider`
   abstraction (`src/lib/brokerage/types.ts`),
   `reconcileLots.ts`'s tax-lot/activity-replay/residual reconciliation
   (12 unit tests), the `snaptrade.ts` adapter (`snaptrade-typescript-sdk`
   — pure JS, no native build step, safe for this Mac), the orchestration
   layer (`sync.ts`) and its five `/api/brokerage/*` routes, a
   `BrokerageConnect` UI on `/holdings` (full-redirect to the Connection
   Portal, not the iframe flow), and the `purchase_date` nullability
   change threaded through every consumer (`washSale.ts`, `taxCheck.ts`,
   `scores.ts`) with visible "Unknown" caveats in the UI rather than a
   fabricated date. Gated behind `SNAPTRADE_CLIENT_ID`/
   `SNAPTRADE_CONSUMER_KEY`, now set in both `.env.local` and Vercel
   production — absent either, `BrokerageConnect` still renders nothing
   and the routes still 501. 169 tests passing,
   `tsc`/`eslint`/`next build` clean.

   **The credentials are a SnapTrade commercial *test* key**
   (`getPartnerInfo` → `name: "Ledger-Check Test"`, `is_personal: false`),
   confirming `snaptrade.ts`'s hardcoded `SnaptradeAuth.commercialApiKey`
   mode is correct. Test keys only reach SnapTrade's simulated `SANDBOX`
   institution (confirmed present in the 37 allowed brokerages) —
   **no real brokerage (Fidelity/Schwab/Robinhood/etc.) can be connected
   until a production key is approved**, in prod or locally. The schema
   migration is applied live (see Database section above) and
   `registerSnapTradeUser` / `loginSnapTradeUser` were exercised directly
   against the live API with a throwaway test user (then deleted via
   `deleteSnapTradeUser`) — both response shapes matched the adapter's
   code exactly, including the `{ redirectURI, sessionId }` narrowing in
   `connectionPortalUrl`. The user then completed the actual browser
   click-through — linked SnapTrade's simulated `SANDBOX` institution
   across both a taxable and a traditional-IRA account, producing real
   rows: 1 `snaptrade_users`, 1 `brokerage_connections`
   (`brokerage_name: "sandbox"`), 2 `accounts` (`sync_source:
   'snaptrade'`), 5 `lots`. **Confirmed `listUserAccounts` /
   `fetchHoldings` / `reconcileLots` all work against real data** — 2 of
   the 5 lots came back with a full tax-lot/activity match (real
   `purchase_date`), 3 came back with only a live position and no
   reconstructable history, correctly falling through to
   `reconcileLots`'s `position-residual` branch (`external_key:
   "TICKER:residual"`, `purchase_date: null`) rather than a fabricated
   date — the first real exercise of that path.

   Re-ran `washSale.ts`/`taxCheck.ts` against this exact live dataset
   (temporary test, not committed): selling part of a null-dated lot at
   a loss correctly returns the `uncheckableLots` wash-sale warning
   instead of a silent pass; a null-dated sell's gain/loss is excluded
   from `shortTermGainLoss`/`longTermGainLoss`/`estimatedTax` and
   surfaced via `unknownTermWarning` instead; the IRA account
   (`traditional_ira`) zeroes every dollar figure regardless of the null
   date, as designed. Sales-history import, scheduled re-sync, and
   disconnect handling remain an explicit follow-up, not this slice.
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
