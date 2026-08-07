import type { Account, Lot, Sale } from "@/lib/types";
import { addDays, todayIso } from "@/lib/dates";

/**
 * A fixture portfolio for the public, no-signup `/demo` page (see
 * `src/app/demo/page.tsx` and `src/app/api/demo/simulate/route.ts`). Not
 * backed by the database — this is the ONLY place demo data is defined, so
 * the landing page's claims and the demo's actual behavior can't drift.
 *
 * Design intent (see CLAUDE.md's Phase 4 GTM section): the fixture exists to
 * make `DEMO_SUGGESTED_TRADE` — buying NVDA in the Traditional IRA — light up
 * three things at once with the REAL engines, not mocked ones:
 *   1. High sector concentration (Information Technology).
 *   2. ETF look-through overlap (VOO and QQQ both already hold NVDA).
 *   3. The IRA-permanent wash-sale case (Rev. Rul. 2008-5) — the single
 *      claim that a broker's own one-account view can't catch.
 *
 * All dates are relative to `todayIso()`, never hardcoded — `checkWashSale`
 * (`src/lib/washSale.ts`) filters sales to a 30-day window from "today", so a
 * literal past date would make the demo silently stop demoing.
 */

export const DEMO_ACCOUNTS: Account[] = [
  { id: 1, name: "Taxable Brokerage", type: "taxable", cashBalance: 2500 },
  { id: 2, name: "Traditional IRA", type: "traditional_ira", cashBalance: 1200 },
];

const TAXABLE_ID = 1;
const IRA_ID = 2;

/** Fixture "live" prices — hardcoded, not fetched. `src/lib/quotes.ts` hits
 *  an unofficial, unauthenticated Yahoo endpoint; calling it from a public,
 *  unauthenticated route risks both rate-limiting and a nondeterministic
 *  demo. These are plausible mid-2026 prices, not real-time data. */
export const DEMO_PRICES = new Map<string, number>([
  ["NVDA", 120],
  ["MSFT", 420],
  ["AAPL", 230],
  ["VOO", 550],
  ["QQQ", 500],
  ["JNJ", 155],
]);

let nextId = 1;

function lot(over: Partial<Lot>): Lot {
  return {
    id: nextId++,
    accountId: TAXABLE_ID,
    accountName: "Taxable Brokerage",
    ticker: "",
    shares: 0,
    costPerShare: 0,
    purchaseDate: null,
    source: "manual",
    ...over,
  };
}

export function demoLots(today: string = todayIso()): Lot[] {
  return [
    // Taxable Brokerage — IT-heavy on purpose (NVDA/MSFT/AAPL).
    lot({
      accountId: TAXABLE_ID,
      accountName: "Taxable Brokerage",
      ticker: "NVDA",
      shares: 15,
      costPerShare: 90,
      purchaseDate: addDays(today, -400), // long-term
    }),
    lot({
      accountId: TAXABLE_ID,
      accountName: "Taxable Brokerage",
      ticker: "MSFT",
      shares: 10,
      costPerShare: 300,
      purchaseDate: addDays(today, -200), // long-term
    }),
    lot({
      accountId: TAXABLE_ID,
      accountName: "Taxable Brokerage",
      ticker: "AAPL",
      shares: 5,
      costPerShare: 150,
      purchaseDate: addDays(today, -100), // short-term
    }),
    lot({
      accountId: TAXABLE_ID,
      accountName: "Taxable Brokerage",
      ticker: "VOO",
      shares: 10,
      costPerShare: 480,
      purchaseDate: addDays(today, -500), // long-term
    }),
    // Traditional IRA — QQQ (IT tilt) + JNJ (Health Care, for balance).
    lot({
      accountId: IRA_ID,
      accountName: "Traditional IRA",
      ticker: "QQQ",
      shares: 8,
      costPerShare: 430,
      purchaseDate: addDays(today, -300),
    }),
    lot({
      accountId: IRA_ID,
      accountName: "Traditional IRA",
      ticker: "JNJ",
      shares: 20,
      costPerShare: 150,
      purchaseDate: addDays(today, -600),
    }),
  ];
}

export function demoSales(today: string = todayIso()): Sale[] {
  const shares = 25;
  const costPerShare = 140;
  const salePricePerShare = 100;
  return [
    {
      id: 1,
      accountId: TAXABLE_ID,
      accountName: "Taxable Brokerage",
      ticker: "NVDA",
      shares,
      salePricePerShare,
      costPerShare,
      acquiredDate: null,
      // Inside the 30-day wash-sale window — see WASH_SALE_WINDOW_DAYS in
      // washSale.ts. Kept well clear of the boundary (10 of 30 days) so the
      // demo doesn't depend on exact same-day edge behavior.
      saleDate: addDays(today, -10),
      realizedGainLoss: (salePricePerShare - costPerShare) * shares,
      source: "manual",
    },
  ];
}

export interface DemoContext {
  accounts: Account[];
  lots: Lot[];
  sales: Sale[];
  prices: Map<string, number>;
}

/** Assembles the full demo context for `simulateTrade`. Fresh arrays each
 *  call (dates are relative to "now"), so this is safe to call per-request
 *  from the API route rather than caching. */
export function demoContext(today: string = todayIso()): DemoContext {
  return {
    accounts: DEMO_ACCOUNTS,
    lots: demoLots(today),
    sales: demoSales(today),
    prices: DEMO_PRICES,
  };
}

/** Preloaded form values for `/demo` — buying NVDA in the Traditional IRA
 *  is the one trade that simultaneously demonstrates sector concentration,
 *  ETF look-through overlap (VOO/QQQ both already hold NVDA), and the
 *  IRA-permanent wash-sale case, because a loss-sale of NVDA exists in
 *  `demoSales()` within the wash-sale window. */
export const DEMO_SUGGESTED_TRADE = {
  side: "buy" as const,
  ticker: "NVDA",
  shares: 20,
  pricePerShare: 112,
  accountId: IRA_ID,
};
