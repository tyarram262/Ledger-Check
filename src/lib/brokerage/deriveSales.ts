import { SHARE_EPSILON, sortForReplay, type ActivityInput } from "@/lib/brokerage/reconcileLots";

/**
 * Turns one ticker's BUY/SELL activity history into dated, priced sale
 * records — the sibling of `reconcileLots.ts` for the SELL side of the same
 * replay. Kept pure (no network) and fully unit-tested for the same reason:
 * a wrong basis here can flip a wash-sale verdict from "flagged" to
 * silently clean.
 *
 * FIFO-consumes open lots the same way `reconcileLots`' activity-replay
 * path does (`sortForReplay` guarantees both use the identical ordering),
 * but instead of only shrinking/discarding the consumed lots, this also
 * emits one `DerivedSale` per SELL with the weighted-average cost of
 * whatever it consumed and the earliest consumed lot's purchase date
 * (FIFO ⇒ the oldest of the shares actually sold).
 *
 * All-or-nothing on partial coverage: if a SELL runs out of open lots
 * before it's fully explained (the brokerage's history doesn't reach back
 * far enough), the *whole* sale gets `costPerShare: null` rather than a
 * blended half-real average — a partial number would look precise but
 * isn't. See CLAUDE.md: "never estimate without clearly labeling
 * assumptions."
 */

export interface DerivedSale {
  /** Stable per-account activity id from SnapTrade — the idempotency key
   *  for `upsertSyncedSales` (`queries.ts`). */
  externalKey: string;
  ticker: string;
  shares: number;
  salePricePerShare: number;
  saleDate: string;
  /** `null` when the activity history couldn't fully explain what was
   *  sold (too shallow) — never a fabricated/blended guess. */
  costPerShare: number | null;
  /** Earliest FIFO-consumed lot's purchase date. Always `null` when
   *  `costPerShare` is `null` — an unknown basis and an unknown
   *  acquisition date are the same underlying gap. */
  acquiredDate: string | null;
}

export interface DeriveSalesResult {
  sales: DerivedSale[];
  warnings: string[];
}

interface OpenLot {
  shares: number;
  costPerShare: number;
  purchaseDate: string;
}

/** Reconstructs sale records for one ticker from its BUY/SELL history. */
export function deriveSales(ticker: string, activities: ActivityInput[]): DeriveSalesResult {
  const warnings: string[] = [];
  const sorted = sortForReplay(activities);

  const open: OpenLot[] = [];
  const sales: DerivedSale[] = [];

  for (const a of sorted) {
    if (a.type === "BUY") {
      if (a.units > SHARE_EPSILON) {
        open.push({ shares: a.units, costPerShare: a.pricePerShare, purchaseDate: a.tradeDate });
      }
      continue;
    }

    // SELL
    if (a.units <= SHARE_EPSILON) continue;

    let toSell = a.units;
    let costOfSold = 0;
    let sharesConsumed = 0;
    let earliestPurchaseDate: string | null = null;

    while (toSell > SHARE_EPSILON && open.length > 0) {
      const lot = open[0];
      const sold = Math.min(lot.shares, toSell);
      costOfSold += sold * lot.costPerShare;
      sharesConsumed += sold;
      if (earliestPurchaseDate === null) earliestPurchaseDate = lot.purchaseDate;
      lot.shares -= sold;
      toSell -= sold;
      if (lot.shares <= SHARE_EPSILON) open.shift();
    }

    const fullyCovered = toSell <= SHARE_EPSILON;
    const costPerShare = fullyCovered && sharesConsumed > SHARE_EPSILON ? costOfSold / sharesConsumed : null;

    if (!fullyCovered) {
      warnings.push(
        `${ticker}: a ${a.tradeDate} sale of ${a.units} shares couldn't be priced — your brokerage's transaction history doesn't go back far enough to determine its cost basis, so it can't be confirmed as a loss for wash-sale checks.`
      );
    }

    sales.push({
      externalKey: a.externalKey,
      ticker,
      shares: a.units,
      salePricePerShare: a.pricePerShare,
      saleDate: a.tradeDate,
      costPerShare,
      acquiredDate: costPerShare !== null ? earliestPurchaseDate : null,
    });
  }

  return { sales, warnings };
}
