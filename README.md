# Ledger Check (MVP)

A single-purpose personal finance tool: a plain-English "gut check" before you
place a trade — how it changes your sector concentration, and whether it risks
a wash sale (including cross-account wash sales involving IRAs).

## Run it

```bash
npm install
npm run dev
```

Requires **Node 22.5+** (uses the built-in `node:sqlite` module — no native
dependencies). Data persists to `data/ledger.db` (gitignored).

For the AI digest, add your key to `.env.local`:

```
GEMINI_API_KEY=your-key-here
```

## Pages

- **/** — Dashboard: sector allocation donut, concentration score
  (>25% in one sector = elevated, >40% = high), AI risk digest.
- **/holdings** — Enter accounts, purchase lots, and past sales (past sales
  power the wash-sale check).
- **/simulate** — The core feature: enter a hypothetical trade, see the
  before/after sector allocation and a one-sentence verdict, with wash-sale
  warnings in both directions:
  - **Buy** flagged when the same ticker was sold at a loss in the past
    30 days in any account.
  - **Sell at a loss** flagged when shares of the same ticker were bought in
    the past 30 days and would still be held.

## MVP simplifications (deliberate)

- Portfolio values use **cost basis** (no live price feed).
- Sector mapping is a static local table (`src/data/sector-map.json`,
  ~100 common tickers); ETFs map to a single "primary tilt" sector, not a
  true look-through.
- Wash-sale check is **binary** — any ticker match in the window flags,
  regardless of share counts (the real rule disallows losses proportionally).
- "Substantially identical" means same ticker only (no fund matching).
- Single user, local only — no auth, no brokerage linking.

This is a validation MVP, not tax software. Nothing here is tax advice.
