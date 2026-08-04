# Ledger Check (MVP)

A single-purpose personal finance tool: a plain-English "gut check" before you
place a trade — how it changes your sector concentration, and whether it risks
a wash sale (including cross-account wash sales involving IRAs).

## Run it

```bash
npm install
npm run dev
```

Multi-user, backed by Supabase (Postgres + Auth). Add these to `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
CLAUDE_API_KEY=your-key-here   # for the AI digest (Claude 4.5 Haiku)
NEXT_PUBLIC_APP_URL=https://ledger-check-henna.vercel.app
```

Sign-in is passwordless (magic link via email) — see "Auth setup" below for
the one-time dashboard configuration a fresh Supabase project needs.

Run the unit tests (wash-sale windows, FIFO, concentration, CSV parsing —
all pure functions, no database needed):

```bash
npm test
```

### Auth setup (one-time, per Supabase project)

The schema, RLS policies, and `record_sell` function are applied as a
migration — nothing to run manually there. Two things Supabase's Dashboard
manages instead of code:

1. **URL Configuration** (Authentication → URL Configuration): set the Site
   URL to your app's URL (e.g. `http://localhost:3000` for local dev).
2. **Email template** (Authentication → Email Templates → Magic Link): change
   the link to route through the app's token-exchange endpoint instead of
   Supabase's default confirmation URL:
   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Sign in</a>
   ```

  In production, set `NEXT_PUBLIC_APP_URL` to the deployed Vercel URL so the
  emailed link never points at `localhost`.

## Pages

- **/** — Dashboard: sector allocation donut, concentration score
  (>25% in one sector = elevated, >40% = high), AI risk digest, and a
  "Refresh prices" button that pulls current quotes (Yahoo Finance,
  unofficial endpoint) so allocations use market value instead of cost.
- **/holdings** — Enter accounts, purchase lots, and past sales (past sales
  power the wash-sale check). Also imports brokerage CSV exports — needs
  symbol, quantity, cost (per-share or total), and date columns.
- **/simulate** — The core feature: enter a hypothetical trade, see the
  before/after sector allocation and a one-sentence verdict, with wash-sale
  warnings in both directions:
  - **Buy** flagged when the same ticker was sold at a loss in the past
    30 days in any account.
  - **Sell at a loss** flagged when shares of the same ticker were bought in
    the past 30 days and would still be held.
  - When the replacement shares sit in a Roth or Traditional IRA, the warning
    is flagged as **permanently disallowed** (Rev. Rul. 2008-5) rather than
    the normal deferred-into-cost-basis outcome — a materially worse result
    the tool calls out explicitly.
- **/settings** — The informational disclaimer, known limitations (same-ticker
  wash-sale detection only, binary match, no spousal/non-US support), and the
  sector-concentration "elevated" threshold (default 25%, configurable).

## MVP simplifications (deliberate)

- Prices come from an unofficial Yahoo Finance endpoint, refreshed only on
  demand; tickers without a stored quote fall back to **cost basis**.
- Sector mapping is a static local table (`src/data/sector-map.json`,
  all S&P 500 constituents + ~24 popular ETFs); ETFs map to a single
  "primary tilt" sector, not a true look-through.
- Wash-sale check is **binary** — any ticker match in the window flags,
  regardless of share counts (the real rule disallows losses proportionally).
- "Substantially identical" means same ticker only (no fund matching).
- Multi-user via Supabase Auth (magic link) + Postgres with row-level
  security, but no brokerage linking yet — holdings and sales are still
  entered manually or via CSV import.

This is a validation MVP, not tax software. Nothing here is tax advice.
