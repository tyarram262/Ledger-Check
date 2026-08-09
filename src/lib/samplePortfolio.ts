import type { AccountType } from "@/lib/types";
import { addDays, todayIso } from "@/lib/dates";
import { demoLots, demoSales } from "@/lib/demoPortfolio";

/**
 * The one-click "Load a sample portfolio" seed on the `/holdings` and `/`
 * zero-states (see CLAUDE.md's Phase 4 slice 2 first-run-trap fix). Derived
 * from the same fixture `/demo` runs (`demoPortfolio.ts`'s `demoLots`/
 * `demoSales`) so the landing page's claims, the no-signup `/demo` tour, and
 * this seeded starter portfolio can't drift apart — three surfaces telling
 * the same story about the same two accounts.
 *
 * Unlike `/demo`, this produces *real* database rows for the signed-in
 * user, so `sampleSeedPlan` deliberately discards every fixture id:
 * `demoLots()`/`demoSales()` assign ids from a module-level counter in
 * `demoPortfolio.ts` that keeps incrementing across calls within a process
 * (fine for a stateless per-request demo, not something to persist).
 * Postgres assigns the real ids on insert; the route pairs each seeded lot
 * back to its real account by the fixture's account id (1 = taxable, 2 =
 * IRA), not by any id from the fixture rows themselves.
 *
 * The wash-sale-triggering sale is a real, dated row once seeded, not a
 * live "today minus 10 days" fixture recomputed per request — so unlike
 * `/demo`, it ages out of `checkWashSale`'s 30-day window (`washSale.ts`)
 * about three weeks after loading. That's honest behavior for real data,
 * not a bug: a stale sample sale should stop demoing the wash-sale panel
 * exactly like a stale real one would.
 */

const SAMPLE_TAXABLE_NAME = "Sample Taxable Brokerage";
const SAMPLE_IRA_NAME = "Sample Traditional IRA";

export interface SampleAccountPlan {
  /** The fixture's account id (1 or 2, from `demoPortfolio.ts`) — used only
   *  to group this plan's lots/sale to the right freshly-inserted account,
   *  never persisted or treated as a real id. */
  fixtureAccountId: number;
  name: string;
  type: AccountType;
  cashBalance: number;
}

export interface SampleLotPlan {
  ticker: string;
  shares: number;
  costPerShare: number;
  purchaseDate: string;
}

export interface SampleSalePlan {
  fixtureAccountId: number;
  ticker: string;
  shares: number;
  salePricePerShare: number;
  costPerShare: number;
  saleDate: string;
}

export interface SampleSeedPlan {
  accounts: SampleAccountPlan[];
  lotsByFixtureAccountId: Map<number, SampleLotPlan[]>;
  sales: SampleSalePlan[];
}

/** Builds the seed plan. `today` is injectable for tests; production calls
 *  always use the default so seeded dates are relative to "now", same
 *  discipline as `demoContext()`. */
export function sampleSeedPlan(today: string = todayIso()): SampleSeedPlan {
  const lots = demoLots(today);
  const sales = demoSales(today);

  const lotsByFixtureAccountId = new Map<number, SampleLotPlan[]>();
  for (const lot of lots) {
    const list = lotsByFixtureAccountId.get(lot.accountId) ?? [];
    list.push({
      ticker: lot.ticker,
      shares: lot.shares,
      costPerShare: lot.costPerShare,
      // demoLots() never leaves purchaseDate null (see its fixtures), but
      // guard anyway since Lot.purchaseDate is nullable in general and
      // createLot requires a non-null date.
      purchaseDate: lot.purchaseDate ?? addDays(today, -1),
    });
    lotsByFixtureAccountId.set(lot.accountId, list);
  }

  return {
    accounts: [
      { fixtureAccountId: 1, name: SAMPLE_TAXABLE_NAME, type: "taxable", cashBalance: 2500 },
      { fixtureAccountId: 2, name: SAMPLE_IRA_NAME, type: "traditional_ira", cashBalance: 1200 },
    ],
    lotsByFixtureAccountId,
    sales: sales.map((s) => ({
      fixtureAccountId: s.accountId,
      ticker: s.ticker,
      shares: s.shares,
      salePricePerShare: s.salePricePerShare,
      // demoSales() never leaves costPerShare null (it's the one seeded
      // loss sale, not a synced/unpriced one) — createSale requires it.
      costPerShare: s.costPerShare ?? 0,
      saleDate: s.saleDate,
    })),
  };
}
