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
  `tyarram262/Ledger-Check` auto-deploys on push to `main`. Prod and
  local share the same single Supabase project (one `NEXT_PUBLIC_SUPABASE_URL`
  everywhere) — there is no separate prod database.
- AI digest and trade review call **Claude** (`claude-haiku-4-5` via
  `@anthropic-ai/sdk`) directly — not an OpenAI-compatible abstraction
  layer (a real gap against the AI-philosophy principle below if
  multi-provider ever matters; a reasonable simplification for now). Both
  Claude-calling endpoints share a Postgres-backed rate limit — see
  Database section.
- Holdings/sales: manual entry, CSV import, and SnapTrade brokerage sync
  via the `BrokerageProvider` abstraction in `src/lib/brokerage/` — see
  roadmap Phase 2 below.
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
  plus a denormalized snapshot, so an entry survives its lot's lifecycle).
  FIFO ordering is `purchase_date asc nulls last, id asc`, matching
  `previewFifoSell`'s ordering in `washSale.ts`.
- **SnapTrade brokerage sync (Phase 2).** `lots.purchase_date` is nullable
  (a synced lot with no reconstructable purchase date — see
  `reconcileLots.ts` — is `null`, never a fabricated date); `lots` has
  `source`/`external_key` (plain `UNIQUE` on `(account_id, external_key)`,
  **not** a partial index — supabase-js's `{ onConflict: "account_id,external_key" }`
  compiles to `ON CONFLICT (account_id, external_key)` with no predicate,
  which Postgres can only resolve against a non-partial unique constraint;
  NULLs still coexist freely since Postgres treats them as distinct);
  `brokerage_connections` and `snaptrade_users` (holds the SnapTrade
  `user_secret`, **encrypted at rest** — see `src/lib/encryption.ts` and
  `queries.ts`'s `getSnapTradeCredentials`/`saveSnapTradeCredentials`;
  never select the raw column into a client component or log it), both
  RLS-scoped like every other table; `accounts` has
  `snaptrade_account_id`/`connection_id`/`sync_source`, same
  plain-`UNIQUE` treatment on `(user_id, snaptrade_account_id)`.
  `brokerage_connections.disabled` exists but is **never written** —
  detecting a broken/revoked connection needs scheduled re-sync or a
  `listBrokerageAuthorizations` poll, neither of which exist yet (Phase 2
  follow-up, not started).
- `ai_rate_limits` — one row per user, backing `check_ai_rate_limit(...)`
  (a `record_sell`-style `SECURITY INVOKER` function with `for update`
  row locking), a fixed-window counter shared across `/api/digest` and
  `/api/trade-review` (5 combined Claude calls/hour/user, see
  `src/lib/aiRateLimit.ts`). No Redis — Postgres is the only shared store
  by design.
- **No `SUPABASE_SERVICE_ROLE_KEY` anywhere, by design.** Every RLS policy
  is written so the user's own session is sufficient. Don't introduce it
  unless a genuine admin-only operation requires it.

## Auth flow

- `src/proxy.ts` + `src/lib/supabase/proxy.ts` gate every route except
  `/login` and `/auth/*`.
- `login/actions.ts` derives `emailRedirectTo` from the request's `Origin`
  header so one Supabase project serves both localhost and prod (Supabase
  only has one `Site URL`) — hard-fails with a user-facing error if
  `Origin` is missing, rather than silently falling back to Site URL.
- Two email templates matter: Supabase's **"Confirm signup"** (new
  address) and **"Magic Link"** (returning). Both use PKCE-style links.
  **Both must render `{{ .RedirectTo }}`, not `{{ .SiteURL }}`** —
  `.SiteURL` ignores `emailRedirectTo` entirely and always resolves to the
  project's single configured Site URL, which will otherwise send every
  prod sign-in to `localhost`. Template link shape:
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`. Editing a
  template requires custom SMTP configured first.
- **Custom SMTP is live via Resend** (`smtp.resend.com:465`, sender
  `onboarding@resend.dev`) — any address can sign up, not just the
  account owner's.
- Supabase Dashboard → Authentication → URL Configuration needs **Site
  URL** set to the prod domain, plus both the localhost and prod
  `/auth/confirm` origins in Additional Redirect URLs (wildcarded, e.g.
  `https://ledger-check-henna.vercel.app/**`). No MCP tool covers
  Auth/SMTP/template config — dashboard-only, user must do it.
- **Don't reintroduce anonymous sign-in on `/login`** — tried and
  reverted (auto-firing `signInAnonymously()`). Anonymous sign-ins aren't
  enabled in Supabase, and every anonymous session mints a fresh
  `auth.uid()`, orphaning the demo portfolio under RLS. A demo/guest mode
  belongs behind an explicit opt-in button, not as default `/login`
  behavior.

## What's built vs. the MVP

Portfolio Import is the foundation everything else sits on, not one of
the "5" below — it's done and unremarkable enough to not need its own
slot. **All 5 MVP features are live.**

| Feature | Status | Notes / gap |
|---|---|---|
| **Portfolio Import** (prerequisite) | Done | CSV + manual entry (`/holdings`, `csvImport.ts`), plus the `BrokerageProvider` abstraction (`src/lib/brokerage/`) — see roadmap. |
| **1. Trade Check** | Live | Concentration, sector, ETF overlap, diversification/risk score deltas, overall verdict all live (`/simulate`, `simulate.ts`, `etfOverlap.ts`, `scores.ts`). Missing: estimated volatility impact (no return-series data source), position sizing, behavioral warnings. |
| **2. Tax Check** | Live | Wash-sale warning, short-term gain warning, long-term gain countdown, estimated tax all live (`washSale.ts`, `holdingPeriod.ts`, `taxCheck.ts`). Lot selection is FIFO-only. Every tax figure labeled "estimate only." |
| **3. Portfolio Health Score** | Live | **All 6 sub-scores** live and daily-persisted (`scores.ts`, `/api/health`): Diversification, Concentration, Risk, Sector Balance, Tax Efficiency, Cash Allocation → overall A–F grade. **No sub-score renders an actionable recommendation yet**, only a descriptive sentence (`SubScore.sentence`) — needs a product call on how prescriptive to get without crossing into "AI makes buy/sell decisions." |
| **4. AI Trade Review** | Live | On-demand "second opinion" on `/simulate` (`tradeReview.ts` + `/api/trade-review` + `TradeReviewPanel.tsx`) — a devil's-advocate critique, never a buy/sell call. Stateless (no cache table); reuses the deterministic `SimulationResult` the trade-check panels already show, never computes anything itself. An optional rationale textarea makes the critique a real second opinion instead of re-narrating what's already on screen. |
| **5. Investment Journal** | Live (v1 scope: capture + display only) | Prompted after a real buy, both the manual-entry (`LotForm.tsx`) and record-trade (`TradeSimulator.tsx`) flows; shown inline per lot in `HoldingsTable.tsx`. **Real gap, deliberately not built:** the payoff example ("you said you wouldn't sell unless revenue growth slowed below 15%; it's still 24%") needs *fundamentals* data this app has no source for — `quotes.ts` only stores a current price. V1 instead does an honest, static "this time horizon has closed" line, with no dashboard-level nudges, dismissal state, or entry editing yet. |

A few facts worth knowing that aren't obvious from the code:

- ETF look-through overlap (`etfOverlap.ts` + `src/data/etf-holdings.json`,
  a static top-holdings snapshot for 24 ETFs) flags near-duplicate funds
  and "true" exposure through funds you already hold. IRA sells return
  **zeroed tax figures with an explanation, never a fabricated number**.
- Tax efficiency is computed from **unrealized** lot data only — `sales`
  has no acquisition date, so realized short/long-term can't be
  reconstructed without a schema + `record_sell` change.
- **Financial calculations must never rely on AI — LLMs explain results,
  deterministic code computes them** (see Engineering principles below).
  Fully honored today: every score/warning — `washSale.ts`, `taxCheck.ts`,
  `scores.ts`, `etfOverlap.ts`, `concentration.ts` — is deterministic;
  `digest.ts` and `tradeReview.ts` are the only two places that call
  Claude, and both only narrate/critique numbers computed elsewhere. Even
  the AI-philosophy example sentences below ("You already own similar
  exposure through QQQ") are already produced deterministically by
  `etfOverlap.ts`/`concentration.ts`, not by an LLM.

## Verification log

169 tests passing, `tsc`/`eslint`/`next build` clean, Supabase advisors
clean (aside from the pre-existing, unrelated "leaked password
protection disabled" warning). All 5 MVP features and SnapTrade sync
slice 1 have been exercised via a real authenticated browser session on
both local and the Vercel deployment, including the health score,
trade-check panels (incl. AI second opinion), tax-check panel (incl. IRA
zero-tax case), the journal prompt, and a real SnapTrade sandbox
connect → link → sync cycle. One DB-level subtlety worth remembering:
`journal_entries.lot_id`'s `on delete set null` behavior was confirmed
with a real insert → full-lot-delete → check → clean-up against the
live database, not just assumed from the schema.

Demo data exists under `tanush.yarram@gmail.com` and, separately, an
older copy under `tanush.yarram@icloud.com`. Both: 4 accounts spanning
taxable/Roth/traditional-IRA, holdings weighted so Information Technology
trips the concentration threshold, sales realizing IRA-permanent +
deferred + buy-after-loss wash-sale scenarios.

## The 4-phase roadmap to production readiness

**Where this stands right now:** Phase 1 is closed. Phase 2 slice 1 is
live; slice 2 (below) is the natural next unit of work on this project.
Phase 3 has two of four items done; the other two (Sentry, privacy/ToS)
are unstarted and don't depend on anything else — either can be picked up
any time. Phase 4 hasn't started and depends on nothing in Phases 2-3, so
it's an independent track if getting real users becomes the priority over
more brokerage-sync depth.

1. **Hostable at all** (auth + hosted DB + deploy) — **closed.**
2. **Cut onboarding friction** — SnapTrade brokerage sync, replacing
   manual/CSV entry.
   - **Slice 1 (connect + holdings + cash + disconnect) — live and
     verified**, including a real browser click-through against
     SnapTrade's sandbox and DB-level confirmation of the synced rows.
     Gated behind `SNAPTRADE_CLIENT_ID`/`SNAPTRADE_CONSUMER_KEY` (set in
     both `.env.local` and Vercel production) — absent either,
     `BrokerageConnect` renders nothing and the routes 501. See the
     Database section above for the schema. **The credentials are a
     SnapTrade commercial *test* key**, so only the simulated `SANDBOX`
     institution is reachable — no real brokerage (Fidelity/Schwab/
     Robinhood/etc.) works until a production key is approved, in prod or
     locally; requesting that approval is the actual unlock for this
     phase mattering to a real user. Disconnecting a connection keeps its
     synced accounts/lots as a frozen snapshot (flips `sync_source` to
     `manual`, clears the link) rather than deleting them.
   - **Slice 2 — not started.** Three independent pieces, buildable in
     any order: (a) sales-history import — SnapTrade's BUY/SELL activity
     is already fetched but only used for cost-basis reconstruction,
     nothing writes to `sales`, so realized gains from a synced account
     can't show up in Tax Check yet; (b) scheduled/automatic re-sync — a
     Vercel Cron hitting `syncAccounts()` for every linked connection,
     today it's purely user-initiated; (c) broken-connection detection —
     the `disabled` column exists and is read into the UI already but
     nothing ever writes it, needs either (b)'s cron to poll
     `listBrokerageAuthorizations` or an error-path check inside
     `syncOneAccount` when a sync call fails in an auth-revoked way.
3. **Trust & polish.** Rate-limiting the AI endpoints (`ai_rate_limits`,
   5 combined Claude calls/hour/user) and encrypting the SnapTrade
   `user_secret` at rest (`src/lib/encryption.ts`, AES-256-GCM) are
   **done** — see Database section. **Not started, no dependencies on
   anything else:** Sentry/error tracking (zero error-reporting exists
   today — failures surface only as an unlogged 500, so a first
   production bug would be invisible until a user reports it), and a real
   privacy policy/ToS (no `/privacy` or `/terms` route exists yet; more
   pressing now that real brokerage credentials are stored, even
   encrypted).
4. **Get users.** A landing/waitlist page pitching the cross-account
   wash-sale angle; DIY-investor communities over paid ads. **Not
   started** — there is no public marketing page today; `proxy.ts` allows
   only `/login` and `/auth/*` while signed out, so any future public
   page must be added to that allowlist or it will redirect to login.

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
deterministic code computes them** (see "What's built vs. the MVP" above
for how this is honored today).

## Forget AI agents, forget autonomous investing — build something people trust

The framing behind every version below. v1 is five deterministic-first
features people can verify by hand; only v2 adds proactive intelligence,
and only v3 starts reasoning across all of it together. Skipping straight
to "AI agent that manages your portfolio" is exactly what this product is
not — see AI philosophy above.

## MVP scope (v1)

Portfolio Import (CSV + manual entry, done — design so brokerage APIs
like Plaid/SnapTrade slot in later without a rewrite) is the prerequisite
everything below sits on. Build order, status and gaps for each are in
"What's built vs. the MVP" above — **all five are live**: Trade Check,
Tax Check, Portfolio Health Score, AI Trade Review, Investment Journal.

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
