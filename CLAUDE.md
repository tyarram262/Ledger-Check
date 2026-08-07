@AGENTS.md
# Session handoff — READ THIS FIRST (updated 2026-08-07, Phase 4 slice 1: public landing page + no-signup demo)

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
  `brokerage_connections.disabled` is now **written**, by `sync.ts`'s
  `syncOneAccount` on an auth-revoked (401/403) `fetchHoldings` failure
  (`snaptrade.ts`'s `isAuthRevokedError`), and cleared on the next
  successful sync (`touchConnectionSynced`) — no cron needed for this part
  of detection; see roadmap Phase 2 slice 2(c).
- **Sales import (Phase 2 slice 2a).** `sales` gained `external_key`
  (idempotent brokerage-sync upsert, same plain-`UNIQUE`-not-partial-index
  reasoning as `lots` above) and nullable `acquired_date`; `cost_per_share`
  and `realized_gain_loss` are now **nullable**, and `source` widened to
  include `'snaptrade'`. A synced SELL is reconstructed by FIFO-replaying
  BUY/SELL activity (`src/lib/brokerage/deriveSales.ts`, sibling to
  `reconcileLots.ts`, sharing its `sortForReplay` ordering helper); when
  the replay runs out of history before fully explaining a SELL, the sale
  is still imported but with `cost_per_share: null` (**all-or-nothing**,
  never a blended half-real average) and surfaced to `checkWashSale`'s buy
  side as an `UncheckableSale` — same "can't prove it's not a loss, so
  don't silently pass" logic as `Lot.purchaseDate: null` already used on
  the sell side. When an `UncheckableSale` is the *only* evidence for a
  buy-side warning, `checkWashSale` reports `isIraPermanent: false`
  regardless of the buy's account — "permanently disallowed" is a claim
  about a confirmed loss, and an unpriced sale hasn't confirmed one; see
  Verification log below for the bug this caught. **No delete sweep** on
  sync (unlike `upsertSyncedLots`):
  a sale that drops out of the fetched activity window is still a
  historical fact, not a closed position, so it's kept. Sales are derived
  for *every* ticker with BUY/SELL history, not just tickers with a live
  position — a fully-exited position's loss sale is exactly what the
  wash-sale check needs and would otherwise never be visited.
  `getAccountActivities` is now paginated (`snaptrade.ts`'s
  `fetchAllActivities`) rather than relying on the SDK's default 1000-row
  limit, which an active account's SELL history could silently exceed.
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
| **2. Tax Check** | Live | Wash-sale warning, short-term gain warning, long-term gain countdown, estimated tax all live (`washSale.ts`, `holdingPeriod.ts`, `taxCheck.ts`). Lot selection is FIFO-only. Every tax figure labeled "estimate only." The buy-side wash-sale check now also reads brokerage-synced sales (Phase 2 slice 2a) — previously a synced account's sold-at-a-loss ticker was invisible to it, a real false-negative on this feature's main draw. |
| **3. Portfolio Health Score** | Live | **All 6 sub-scores** live and daily-persisted (`scores.ts`, `/api/health`): Diversification, Concentration, Risk, Sector Balance, Tax Efficiency, Cash Allocation → overall A–F grade. **No sub-score renders an actionable recommendation yet**, only a descriptive sentence (`SubScore.sentence`) — needs a product call on how prescriptive to get without crossing into "AI makes buy/sell decisions." |
| **4. AI Trade Review** | Live | On-demand "second opinion" on `/simulate` (`tradeReview.ts` + `/api/trade-review` + `TradeReviewPanel.tsx`) — a devil's-advocate critique, never a buy/sell call. Stateless (no cache table); reuses the deterministic `SimulationResult` the trade-check panels already show, never computes anything itself. An optional rationale textarea makes the critique a real second opinion instead of re-narrating what's already on screen. |
| **5. Investment Journal** | Live (v1 scope: capture + display only) | Prompted after a real buy, both the manual-entry (`LotForm.tsx`) and record-trade (`TradeSimulator.tsx`) flows; shown inline per lot in `HoldingsTable.tsx`. **Real gap, deliberately not built:** the payoff example ("you said you wouldn't sell unless revenue growth slowed below 15%; it's still 24%") needs *fundamentals* data this app has no source for — `quotes.ts` only stores a current price. V1 instead does an honest, static "this time horizon has closed" line, with no dashboard-level nudges, dismissal state, or entry editing yet. |

A few facts worth knowing that aren't obvious from the code:

- ETF look-through overlap (`etfOverlap.ts` + `src/data/etf-holdings.json`,
  a static top-holdings snapshot for 24 ETFs) flags near-duplicate funds
  and "true" exposure through funds you already hold. IRA sells return
  **zeroed tax figures with an explanation, never a fabricated number**.
- Tax efficiency is computed from **unrealized** lot data only. `sales`
  now has a nullable `acquired_date`, but only the SnapTrade sales-import
  path populates it (`deriveSales.ts`) — `record_sell` (manual/recorded
  sales) was deliberately left alone rather than touching the atomic FIFO
  function every manual sell depends on, so realized short/long-term still
  can't be reconstructed for manually-entered sales.
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

191 tests passing, `tsc`/`eslint`/`next build` clean, Supabase advisors
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

**Phase 2 slice 2a/2c (sales import + connection health) — live-verified.**
13 new tests (`deriveSales.test.ts`'s FIFO-replay suite, `washSale.test.ts`'s
uncheckable-sale branches, a `simulate.test.ts` regression test — see
below), `tsc`/`eslint`/`next build` clean, Supabase advisors clean. The
new migration (`sales_brokerage_import`) and `upsertSyncedSales`'s upsert
semantics were verified directly against the live database: a raw
`INSERT ... ON CONFLICT (account_id, external_key)` run twice with a
changed price produced one row, not two, and a null-basis sale's
`realized_gain_loss` stayed `null` rather than coercing to `0`; the test
row was deleted afterward. **Fixed along the way, not searched for
separately:** `simulate.ts`'s verdict-sentence builder did
`washSale.triggers.at(-1)!` — but `checkWashSale` already had a
`triggers: []` return case (an uncheckable, null-dated lot on a sell) that
this assertion didn't account for, so selling a synced ticker at a loss
while an undated residual lot remained held threw an unlogged 500 on
`/api/simulate`. The new buy-side uncheckable-sale branch added a second
path into the same empty-triggers state, so the assertion had to go
regardless — `simulate.test.ts` now pins this with a fixture that
previously would have thrown. **A second bug in that same branch was
caught in review, not testing:** the uncheckable-only buy-side case
returned `isIraPermanent` computed from the buy account, so buying into an
IRA against an unpriced synced sale rendered TradeSimulator's red
"⚠️ loss permanently disallowed (IRA)" panel — asserting a permanent tax
consequence for a loss that was never confirmed. Fixed by hardcoding
`isIraPermanent: false` on that branch (matching the sell-side uncheckable
branch, which already did this) and splitting TradeSimulator's wash-sale
panel into a third, amber "can't fully check" state whenever
`triggers.length === 0`, rather than only red/red-IRA. Pinned by a new
`washSale.test.ts` case.

**Browser-verified** (SnapTrade's sandbox returns account metadata and
cash but no positions/BUY/SELL activity — see the sandbox-limitation note
below — so `deriveSales` had nothing to replay through it; sales import
was instead exercised by seeding three `source: 'snaptrade'` rows directly
under `tanush.yarram@gmail.com`'s synced "Individual"/"IRA" accounts, one
priced loss + two null-basis, spanning NVDA and MSFT): the sales table
shows a "Synced" badge with grey "Unknown"/"—" cells for the two
null-basis rows; buying NVDA (null-basis-only evidence) renders the amber
"Can't fully check this for a wash sale" panel in **both** the taxable and
the IRA account (confirming the isIraPermanent fix — a stray `true` here
would have shown the red IRA panel instead); buying MSFT (one confirmed
loss + one null-basis) renders the red panel with the loss trigger plus
the amber "Additionally, ..." caveat line in the taxable account, and
escalates to the red "⚠️ permanently disallowed (IRA)" panel in the IRA
account. All five checks passed. Seeded rows deleted after; the four
lots (NVDA/MSFT/KO/JNJ) seeded alongside them were kept as gmail's demo
portfolio rather than deleted — see the demo-data paragraph below.

**Sandbox limitation, worth knowing for any future SnapTrade work:** the
configured sandbox institution (`SNAPTRADE_CLIENT_ID`/`SNAPTRADE_CONSUMER_KEY`,
test key) returns cash balance and account metadata on connect, but no
positions and no BUY/SELL activity — `reconcileLots`/`deriveSales` have
nothing to reconstruct from it. Slice 1's lot-sync path was verified
against this same sandbox and still holds (a synced account can be empty
and that's a legitimate outcome), but slice 2a's FIFO sale replay has
**never been exercised against a real SnapTrade activity feed** — only
against seeded rows shaped like what the replay would produce. One more
reason the production-key approval (see Phase 2 slice 1 above) is the
real unlock, not just for real brokerages but for testing this path at
all.

**`tanush.yarram@icloud.com` no longer exists** — the account (and its
accounts/lots/sales via cascade) was gone from `auth.users` as of
2026-08-07; it's not just an SMTP sign-in issue, the row itself is
deleted. `tanush.yarram@gmail.com` is now the **only** user and the one to
test against. Its demo portfolio: taxable "Individual" (NVDA/MSFT/KO/JNJ,
manual lots seeded during this session, weighted so Information Technology
trips the concentration threshold) and traditional-IRA "IRA", both
SnapTrade-linked (`sync_source: 'snaptrade'`, accounts 13/14) with cash
synced from the sandbox ($25,000/$12,500) but no synced lots (see the
sandbox limitation above — nothing to sync). **Also found and removed
this session:** two other manual accounts (ids 11/12) existed with the
exact same display names, "Individual" and "IRA" — empty shells that
predated any real data, colliding in name with the real synced 13/14 with
no way to tell them apart in the UI (`createAccount`/`upsertSnapTradeAccount`
in `queries.ts` have no name-collision check against each other). Testing
landed a stray manual lot in each by mistake; both accounts were deleted
outright rather than just clearing the lots, since they had no purpose
besides the collision. **Real gap, not fixed:** nothing stops this from
recurring — a manual "add account" flow or a future SnapTrade link that
happens to reuse a display name like "Individual" will silently collide
again. Worth a UI account-picker disambiguator (e.g. show sync source
next to the name) if this keeps causing confusion, but out of scope for
Phase 2 slice 2/Phase 3 as currently understood.

## The 4-phase roadmap to production readiness

**Where this stands right now:** Phase 1 is closed. Phase 2 slice 1 is
live; slice 2 is now two-thirds done (2a, 2c — see below), with 2b the
one remaining piece and it's blocked on a design decision, not just
unstarted. **Phase 3 is fully closed** — rate-limiting, encryption, Sentry,
and privacy/ToS are all done (2026-08-07). **Phase 4 slice 1 (public
landing page + no-signup live demo) is done as of 2026-08-07** — see below
for the funnel it's built around and what's still open. The highest-value
next step is fixing the first-run trap on `/holdings` (a new signup
currently dead-ends there), not more of Phase 2 or 3.

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
   - **Slice 2 — (a) and (c) live, (b) blocked.** Three independent
     pieces:
     - **(a) sales-history import — live.** SnapTrade's BUY/SELL activity
       is FIFO-replayed into `sales` rows (`deriveSales.ts`), including a
       null-basis path for sales the history can't fully price (see the
       Database section's "Sales import" entry above). This was more than
       a roadmap checkbox — before this, a brokerage-synced account's
       loss sales were invisible to `checkWashSale`'s buy side, so a user
       who'd only ever synced (never manually entered a sale) got a
       confidently wrong "no wash sale" verdict. Realized gains from
       synced accounts can now show up in Tax Check; short/long-term
       reconstruction for *manually* recorded sales still can't (see
       above).
     - **(c) broken-connection detection — live, no cron needed.**
       `syncOneAccount` catches a `fetchHoldings` failure, and when
       `isAuthRevokedError` says it's a 401/403 (not a transient
       429/5xx), flags `brokerage_connections.disabled` — cleared
       automatically on the next successful sync. Turned out not to need
       (b)'s cron or a `listBrokerageAuthorizations` poll at all; both
       were speculative solutions written before anyone had looked at
       what `syncOneAccount`'s error path could already do.
     - **(b) scheduled/automatic re-sync — still not started, and now
       understood to be blocked, not just undone.** A Vercel Cron hitting
       `syncAccounts()` for every linked connection needs a way to act
       across users, but `syncAccounts()` runs through the cookie-bound,
       RLS-scoped `createClient()`, and there is **no
       `SUPABASE_SERVICE_ROLE_KEY` anywhere, by design** (see Database
       section). A cron route would also need a `PUBLIC_PATHS` entry in
       `src/lib/supabase/proxy.ts` or it's redirected to `/login` like
       every other unauthenticated request. Needs an explicit decision —
       introduce a service-role client for this one case, or do
       stale-on-page-load re-sync under the user's own session instead of
       a cron — before picking this back up.
3. **Trust & polish — all four items done.** Rate-limiting the AI endpoints
   (`ai_rate_limits`, 5 combined Claude calls/hour/user) and encrypting the
   SnapTrade `user_secret` at rest (`src/lib/encryption.ts`, AES-256-GCM) —
   see Database section. Sentry error tracking and a privacy policy/ToS —
   see the two sub-bullets just below.
   - **Privacy Policy + Terms of Service — done.** `/privacy`
     (`src/app/privacy/page.tsx`) and `/terms` (`src/app/terms/page.tsx`),
     both added to `PUBLIC_PATHS` in `src/lib/supabase/proxy.ts` so they're
     reachable signed-out (confirmed against the running dev server: `200`
     with real content, vs. `/holdings`'s `307` to `/login`), linked from
     `layout.tsx`'s shared footer on every page. Content is an honest,
     plain-language description of *actual current behavior* — what's
     collected, that Supabase/Vercel/SnapTrade/Resend/Anthropic are the
     only parties data reaches, no ads/selling/third-party tracking, the
     one session cookie, and that there's no self-serve deletion yet
     (email-request only) — not boilerplate, and **both pages explicitly
     say they haven't been reviewed by an attorney and need real legal
     review before Phase 4's public push**, same honesty standard as the
     Disclaimer &amp; settings page's "known limitations" list. Contact
     email is `tanush.yarram@gmail.com` (explicit user decision,
     2026-08-07) and the pages refer to the operator generically as
     "Ledger Check"/"we" rather than claiming a business entity that
     doesn't exist (also an explicit decision that day) — revisit both if
     that changes.
   - **Sentry (`@sentry/nextjs`) — done, gated on a DSN that hasn't been
     added yet.** `src/instrumentation.ts` (Next 16's `register()` +
     `onRequestError` convention — verified against
     `node_modules/next/dist/docs/.../instrumentation.md`, per AGENTS.md)
     dynamically imports `sentry.server.config.ts`/`sentry.edge.config.ts`
     by `NEXT_RUNTIME`; `src/instrumentation-client.ts` covers the browser;
     `src/app/global-error.tsx` — previously missing entirely — now reports
     root-layout render errors that escape every nested `error.tsx`. All
     four are gated on `NEXT_PUBLIC_SENTRY_DSN` (unset today, same pattern
     as `SNAPTRADE_CLIENT_ID`/`SNAPTRADE_CONSUMER_KEY` gating
     `BrokerageConnect`) — absent, `Sentry.init` is never called and
     `Sentry.captureRequestError`/`captureRouterTransitionStart` are safe
     no-ops (confirmed by invoking `onRequestError` directly with no DSN
     set — completed with no throw). `next.config.ts`'s `withSentryConfig`
     wrapper disables source-map upload unless `SENTRY_AUTH_TOKEN` is set,
     so a build with no Sentry config at all stays exactly as clean as
     before (verified: `next build` with no env vars set produces the same
     clean output). **This app stores encrypted brokerage credentials and
     financial data, so PII scrubbing isn't optional:** `src/lib/sentryScrub.ts`
     (9 tests, `sentryScrub.test.ts`) is a shared `beforeSend` used by all
     three configs — deep-redacts any key matching secret/token/password/
     `api_key`/encryption/authorization/cookie/`consumer_key`/`client_id`
     (covers `user_secret`, `CLAUDE_API_KEY`, `BROKERAGE_TOKEN_ENCRYPTION_KEY`,
     `SNAPTRADE_CONSUMER_KEY`/`SNAPTRADE_CLIENT_ID` regardless of nesting),
     strips `Cookie`/`Authorization` headers, and strips the query string
     off any `/auth/confirm` URL specifically because that query carries a
     live magic-link `token_hash` (see Auth flow above) — a captured error
     URL would otherwise leak a working sign-in link to a third party. Errs
     toward over-redaction (e.g. `external_key`, not actually sensitive,
     still gets swept by the `client_id`/`consumer_key` pattern) rather
     than risk under-redacting. **User action still needed:** create a
     Sentry project, add `NEXT_PUBLIC_SENTRY_DSN` (and optionally
     `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN`) to `.env.local`
     (placeholders already added) and Vercel — no code changes required
     once that's done. Not yet verified: a real event landing in a live
     Sentry dashboard, since no DSN exists yet to test against.
4. **Get users — slice 1 (public front door + no-signup demo) done
   2026-08-07.** The funnel this phase is built around:

   **public page → live demo → signup → first insight → retained → paid.**

   Before this slice, the funnel was severed at step 1: `PUBLIC_PATHS` in
   `src/lib/supabase/proxy.ts` didn't include `/`, so the deployed root URL
   redirected every stranger straight to `/login` — a bare email box with
   no explanation of what the product does, no screenshots, no pitch. The
   only marketing copy anywhere was the `<head>` description string nobody
   reads. There was no way to see the product's value without an email
   round-trip, and no way to see it *after* signing up either, since a
   brand-new account starts with zero holdings (see the first-run trap
   below). A large paying audience was never reachable behind that wall,
   independent of any pricing/billing question.

   **What's live now:**
   - `src/components/Landing.tsx`, rendered by `src/app/page.tsx` for
     signed-out visitors (an `auth.getClaims()` branch — signed-in behavior
     is unchanged). Pitches the specific, checkable claim from this doc's
     domain reference: a wash sale repurchased in an IRA is *permanently*
     disallowed (Rev. Rul. 2008-5), not deferred, and a broker's
     single-account view structurally can't catch it. States pricing
     plainly: **free while in beta**, Pro ($10–15/mo: tax analysis, AI
     second opinion, journal, overlap alerts) named as planned, not sold —
     no tier table for tiers nothing in the schema enforces yet.
   - `/demo` (`src/app/demo/page.tsx`) — a no-signup, no-database live
     product tour. `src/lib/demoPortfolio.ts` is a fixture (two accounts,
     six lots, one loss sale) fed straight into the REAL `simulateTrade`
     engine (`src/lib/simulate.ts`) via a new public route,
     `src/app/api/demo/simulate/route.ts` — this is not a mockup or
     scripted screenshots, it's the same deterministic code a paying user's
     trade check runs, just against fixture data instead of the
     authenticated user's own RLS-scoped rows. `TradeSimulator.tsx` grew a
     `demo` boolean prop (one component, not a fork) that swaps the POST
     target and hides everything requiring auth — the rationale textarea,
     `TradeReviewPanel` (AI costs money and is rate-limited per `user_id`,
     see `aiRateLimit.ts` — an unauthenticated twin has no one to bill or
     throttle), the record-trade button, and the journal prompt — replacing
     the record button with a "Run this on your real portfolio →" link to
     `/login`. The fixture's `DEMO_SUGGESTED_TRADE` (buy NVDA in the
     Traditional IRA) is preloaded so a visitor's first action is one
     click, and it's engineered to trigger concentration, ETF overlap
     (VOO/QQQ both hold NVDA), and the IRA-permanent wash-sale panel
     simultaneously — verified live: the response shows Information
     Technology concentration moving 56%→61%, `isIraPermanent: true`, and
     both ETFs named as overlap contributors; switching the same trade to
     the taxable account flips `isIraPermanent` to `false`, confirming the
     demo runs the real branch logic, not a hardcoded response. All fixture
     dates are computed relative to `todayIso()` (`addDays`, never a
     literal), because `checkWashSale`'s 30-day window is relative to
     "today" — a hardcoded date would have made the demo silently stop
     demoing in about a month. Pinned by 6 new tests in
     `src/lib/demoPortfolio.test.ts`.
   - `src/app/robots.ts` / `src/app/sitemap.ts` (Next 16 file-convention
     metadata routes) list only the public surface (`/`, `/demo`,
     `/privacy`, `/terms`) and explicitly disallow the auth-gated routes.
     **Found and fixed along the way:** `src/proxy.ts`'s matcher doesn't
     exclude `/robots.txt`/`/sitemap.xml`, so without adding them to
     `PUBLIC_PATHS` a signed-out crawler would have been redirected to
     `/login` instead of served the file — both are now explicit entries.
   - `layout.tsx`'s signed-out nav, previously empty, now links "How it
     works" (`/`) and "Try the demo" (`/demo`) plus a "Sign in" button.
     `metadata` grew `openGraph`/`twitter` fields (text-only — no branded
     image asset exists yet, see gap below) so a pasted link renders a real
     preview card instead of a bare URL.
   - The `"/"` entry in `PUBLIC_PATHS` looks like it could open the whole
     app but doesn't: `isPublicPath`'s prefix check is
     `startsWith(\`${p}/\`)`, which for `p = "/"` is `startsWith("//")` —
     true for no real route, so `"/"` matches root only. Commented in place
     in `proxy.ts` so it isn't "fixed" or copied elsewhere as a pattern.

   **Verified:** `npm test` (197 tests, up from 191), `tsc`/`eslint`/`next
   build` clean, and a live signed-out `npm run dev` session — `/` and
   `/demo` return `200`, `/holdings`/`/settings` still `307` to `/login`,
   `/robots.txt` and `/sitemap.xml` serve correctly, `/api/demo/simulate`
   returns the expected IRA-permanent panel for the suggested trade and the
   expected non-IRA panel for the same trade in the taxable account. **Not
   yet done:** a real click-through against the deployed Vercel URL (the
   redirect logic runs differently enough in prod to be worth re-checking,
   per this doc's existing verification standard) and any OG-card
   preview check on a real sharing surface (Reddit/Discord/Slack unfurl).

   **What's still open, in rough priority order:**
   - **First-run trap — the highest-value next slice.** Nothing seeds a
     default account for a new user. On `/holdings`, the "Add a holding"
     button is `disabled={... || accounts.length === 0}` (`LotForm.tsx`,
     same guard in `CsvImport.tsx` and `SaleForm.tsx`) with **no copy
     anywhere explaining why the button is greyed out.** Today's funnel is
     landing → demo → signup → dead end: a brand-new signed-in user hits
     this wall before reaching a single real insight. This slice fixed the
     top of the funnel; this is the very next segment and it's currently
     broken.
   - **SnapTrade production key still not approved** — only the sandbox
     institution works, so no real brokerage (Fidelity/Schwab/Robinhood)
     connects for an actual new user. External approval lead time; filing
     for it is the gating action, not more code.
   - **No analytics anywhere.** Nothing in `package.json` measures any step
     of the funnel this slice just built — no way to tell whether the
     landing page converts, whether anyone reaches `/demo`, or where
     signups drop off. Worth resolving before investing further in
     landing-page copy iteration, which is otherwise a guess.
   - **Billing — deliberately still not built,** per the user's explicit
     scoping decision this session. Revisit once demo→signup→retained shows
     real numbers, not before; there's no one to charge yet regardless of
     Stripe integration effort.
   - **No branded OG/social-preview image** — `openGraph`/`twitter`
     metadata is text-only; a shared link gets a text card, not an image
     card, on platforms that render one.
   - **`src/lib/taxRates.ts` is a 2026 tax-year table** with an "update
     annually" header comment. Was already true before this slice, but a
     public landing page actively inviting outside traffic makes a stale
     table a live liability rather than a dormant one — worth flagging to
     whoever owns the annual update.

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
