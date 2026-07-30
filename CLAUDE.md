@AGENTS.md
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