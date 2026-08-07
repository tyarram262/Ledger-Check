import type { BrokerageLot } from "@/lib/brokerage/types";

/**
 * Turns one SnapTrade position into dated lots — the part of the sync that
 * can actually corrupt a tax verdict if it guesses wrong, so it's kept
 * pure (no network) and fully unit-tested. Three-tier strategy, in order:
 *
 * 1. SnapTrade `tax_lots` data, when present and complete — exact dates,
 *    no reconstruction needed.
 * 2. Otherwise, replay `BUY`/`SELL` activity history through FIFO to
 *    reconstruct dated lots.
 * 3. Reconcile the reconstructed share count against the live position:
 *    a shortfall (the brokerage's history doesn't fully explain the
 *    position — common with a brokerage that only exposes recent history)
 *    becomes one `position-residual` lot with `purchaseDate: null` rather
 *    than a fabricated date; a surplus (history implies more shares than
 *    are actually held — e.g. a transfer-in with no corresponding
 *    activity) trims the oldest reconstructed lots to match.
 *
 * See CLAUDE.md: "never estimate without clearly labeling assumptions."
 */

export const SHARE_EPSILON = 1e-6;

export interface RawTaxLot {
  externalKey: string;
  shares: number;
  costPerShare: number;
  purchaseDate: string;
}

export interface ActivityInput {
  /** Stable per-account activity id from SnapTrade — used as the lot's
   *  `externalKey` when reconstructed via replay. */
  externalKey: string;
  /** Only `"BUY"` and `"SELL"` are handled; every other SnapTrade activity
   *  type (DIVIDEND, FEE, TRANSFER, ...) is ignored by this function —
   *  it isn't a share-count-changing trade. */
  type: string;
  tradeDate: string;
  units: number;
  pricePerShare: number;
}

export interface PositionInput {
  ticker: string;
  shares: number;
  averageCostPerShare: number;
}

export interface ReconcileResult {
  lots: BrokerageLot[];
  warnings: string[];
}

function fromTaxLots(position: PositionInput, taxLots: RawTaxLot[]): ReconcileResult {
  const lots: BrokerageLot[] = taxLots.map((t) => ({
    externalKey: t.externalKey,
    ticker: position.ticker,
    shares: t.shares,
    costPerShare: t.costPerShare,
    purchaseDate: t.purchaseDate,
    basis: "tax-lot",
  }));
  const warnings: string[] = [];
  const totalShares = lots.reduce((sum, l) => sum + l.shares, 0);
  if (Math.abs(totalShares - position.shares) > SHARE_EPSILON) {
    warnings.push(
      `${position.ticker}: tax-lot data totals ${totalShares} shares but the position shows ${position.shares} — using the tax-lot data as-is.`
    );
  }
  return { lots, warnings };
}

interface OpenLot {
  externalKey: string;
  shares: number;
  costPerShare: number;
  purchaseDate: string;
}

/**
 * Filters to BUY/SELL activity and sorts it into replay order: by trade
 * date, then BUY before SELL on the same date. `ActivityInput` carries no
 * intraday timestamp, so same-day ordering would otherwise be arbitrary —
 * BUY-before-SELL is the only assumption under which a same-day
 * buy-then-sell replays correctly. Shared by `fromActivityReplay` below
 * (lot reconstruction) and `deriveSales.ts` (sale reconstruction) so the
 * two can never disagree about replay order for the same activity history.
 */
export function sortForReplay(activities: ActivityInput[]): ActivityInput[] {
  return [...activities]
    .filter((a) => a.type === "BUY" || a.type === "SELL")
    .sort((a, b) => {
      const byDate = a.tradeDate.localeCompare(b.tradeDate);
      if (byDate !== 0) return byDate;
      if (a.type === b.type) return 0;
      return a.type === "BUY" ? -1 : 1;
    });
}

function fromActivityReplay(position: PositionInput, activities: ActivityInput[]): ReconcileResult {
  const warnings: string[] = [];
  const sorted = sortForReplay(activities);

  // FIFO queue of still-open lots, oldest first.
  const open: OpenLot[] = [];
  for (const a of sorted) {
    if (a.type === "BUY") {
      if (a.units > SHARE_EPSILON) {
        open.push({
          externalKey: a.externalKey,
          shares: a.units,
          costPerShare: a.pricePerShare,
          purchaseDate: a.tradeDate,
        });
      }
      continue;
    }
    // SELL: consume oldest-first.
    let toSell = a.units;
    while (toSell > SHARE_EPSILON && open.length > 0) {
      const lot = open[0];
      const sold = Math.min(lot.shares, toSell);
      lot.shares -= sold;
      toSell -= sold;
      if (lot.shares <= SHARE_EPSILON) open.shift();
    }
    if (toSell > SHARE_EPSILON) {
      warnings.push(
        `${position.ticker}: transaction history includes a sell larger than the shares it had recorded — some history is likely missing.`
      );
    }
  }

  const lots: BrokerageLot[] = open.map((l) => ({
    externalKey: l.externalKey,
    ticker: position.ticker,
    shares: l.shares,
    costPerShare: l.costPerShare,
    purchaseDate: l.purchaseDate,
    basis: "activity-replay",
  }));

  const reconstructedShares = lots.reduce((sum, l) => sum + l.shares, 0);
  const diff = position.shares - reconstructedShares;

  if (diff > SHARE_EPSILON) {
    // Shortfall: the position holds more than the replayed history
    // explains (shallow history is common — brokers vary in how far back
    // they expose activities). Bucket the gap as one dated-null lot
    // rather than guess which "real" purchase it corresponds to.
    lots.push({
      externalKey: `${position.ticker}:residual`,
      ticker: position.ticker,
      shares: diff,
      costPerShare: position.averageCostPerShare,
      purchaseDate: null,
      basis: "position-residual",
    });
    warnings.push(
      `${position.ticker}: ${diff} share${diff === 1 ? "" : "s"} have no known purchase date (your brokerage's transaction history doesn't go back far enough to fully explain this position) — excluded from wash-sale and holding-period checks.`
    );
  } else if (diff < -SHARE_EPSILON) {
    // Surplus: replayed history implies more shares than are actually
    // held (e.g. an in-kind transfer with no corresponding activity).
    // Trim the oldest reconstructed lots first — a stale, oversized "held
    // since" date is the more conservative direction to be wrong in for
    // tax purposes than trimming the most recent lot would be.
    let excess = -diff;
    for (const lot of lots) {
      if (excess <= SHARE_EPSILON) break;
      const trim = Math.min(lot.shares, excess);
      lot.shares -= trim;
      excess -= trim;
    }
    warnings.push(
      `${position.ticker}: transaction history implies more shares than are currently held — trimmed the oldest reconstructed lots to match.`
    );
  }

  // A single filter here covers all three branches (shortfall's residual
  // lot is always positive-sized; surplus trimming is the only branch that
  // can zero out a lot; the exact-match branch has nothing to trim).
  return { lots: lots.filter((l) => l.shares > SHARE_EPSILON), warnings };
}

/**
 * Reconciles one position into dated lots. `taxLots` is `null` when
 * SnapTrade's tax-lot data isn't available for this position (disabled by
 * default — paid-plan feature) or came back empty; in that case this
 * falls back to activity replay.
 */
export function reconcileLots(
  position: PositionInput,
  taxLots: RawTaxLot[] | null,
  activities: ActivityInput[]
): ReconcileResult {
  if (taxLots && taxLots.length > 0) {
    return fromTaxLots(position, taxLots);
  }
  return fromActivityReplay(position, activities);
}
