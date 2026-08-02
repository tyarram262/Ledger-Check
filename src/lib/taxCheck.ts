import type { Account, Lot, Sale } from "@/lib/types";
import {
  checkWashSale,
  previewFifoSell,
  type SimulatedTrade,
  type WashSaleWarning,
} from "@/lib/washSale";
import {
  daysUntilLongTerm,
  longTermOn,
  termFor,
  type HoldingTerm,
} from "@/lib/holdingPeriod";
import { longTermRate, shortTermRate, type TaxProfile } from "@/lib/taxRates";

export interface LotTaxDetail {
  lot: Lot;
  sharesSold: number;
  term: HoldingTerm;
  gainLoss: number;
  longTermOn: string;
  daysUntilLongTerm: number;
}

export interface TaxCheckResult {
  /** IRA sells have no current tax consequence — estimates below are zeroed, not fabricated. */
  isIraAccount: boolean;
  washSale: WashSaleWarning | null;
  shortTermGainLoss: number;
  longTermGainLoss: number;
  lotBreakdown: LotTaxDetail[];
  estimatedTax: {
    shortTermTax: number;
    longTermTax: number;
    total: number;
    shortTermRate: number;
    longTermRate: number;
  };
  shortTermWarning: string | null;
  longTermCountdown: {
    shares: number;
    daysAway: number;
    date: string;
    taxSaved: number;
  } | null;
}

function isIraAccount(accounts: Account[], accountId: number | undefined): boolean {
  if (accountId == null) return false;
  const account = accounts.find((a) => a.id === accountId);
  return account?.type === "roth" || account?.type === "traditional_ira";
}

/**
 * Tax check for a hypothetical sell, as of `today`. Sell-only — pass a
 * `trade.side === "sell"` with a valid `accountId`; the caller (`simulate.ts`)
 * is expected to have already validated the trade via `previewFifoSell`.
 *
 * Reuses `checkWashSale` verbatim for the wash-sale field (no change to that
 * engine's behavior), and `previewFifoSell`'s new `consumedLots` for
 * per-lot short/long-term classification, which an averaged basis can't give.
 *
 * IRA accounts (`roth` / `traditional_ira`) have no current-year tax
 * consequence on a sell, so every dollar figure here is zeroed for them
 * rather than computed against a rate that doesn't apply — a Roth
 * withdrawal isn't a taxable event, and a traditional IRA is taxed on
 * distribution, not on an in-account sale.
 */
export function checkTax(
  trade: SimulatedTrade,
  lots: Lot[],
  sales: Sale[],
  accounts: Account[],
  profile: TaxProfile,
  today: string
): TaxCheckResult {
  const washSale = checkWashSale(trade, sales, lots, accounts, today);
  const preview = previewFifoSell(trade, lots);
  const ira = isIraAccount(accounts, trade.accountId);

  const lotBreakdown: LotTaxDetail[] = preview.consumedLots.map(({ lot, shares }) => ({
    lot,
    sharesSold: shares,
    term: termFor(lot.purchaseDate, today),
    gainLoss: (trade.pricePerShare - lot.costPerShare) * shares,
    longTermOn: longTermOn(lot.purchaseDate),
    daysUntilLongTerm: daysUntilLongTerm(lot.purchaseDate, today),
  }));

  const shortTermGainLoss = lotBreakdown
    .filter((d) => d.term === "short")
    .reduce((sum, d) => sum + d.gainLoss, 0);
  const longTermGainLoss = lotBreakdown
    .filter((d) => d.term === "long")
    .reduce((sum, d) => sum + d.gainLoss, 0);

  const stRate = ira ? 0 : shortTermRate(profile);
  const ltRate = ira ? 0 : longTermRate(profile);

  // Only net gains are taxed here — a loss offsets other gains at filing
  // time but isn't itself a tax owed on this trade, and modeling offsets
  // against the rest of the user's year is out of scope for a single-trade estimate.
  const shortTermTax = !ira && shortTermGainLoss > 0 ? shortTermGainLoss * (stRate / 100) : 0;
  const longTermTax = !ira && longTermGainLoss > 0 ? longTermGainLoss * (ltRate / 100) : 0;

  const shortTermWarning =
    !ira && shortTermGainLoss > 0
      ? `$${shortTermGainLoss.toFixed(2)} of this sale would be a short-term gain, taxed as ordinary income at an estimated ${stRate.toFixed(1)}% — instead of the lower long-term rate.`
      : null;

  let longTermCountdown: TaxCheckResult["longTermCountdown"] = null;
  if (!ira) {
    const shortTermGainLots = lotBreakdown.filter((d) => d.term === "short" && d.gainLoss > 0);
    if (shortTermGainLots.length > 0) {
      const nearest = [...shortTermGainLots].sort(
        (a, b) => a.daysUntilLongTerm - b.daysUntilLongTerm
      )[0];
      const taxSaved = nearest.gainLoss * ((stRate - ltRate) / 100);
      if (taxSaved > 0) {
        longTermCountdown = {
          shares: nearest.sharesSold,
          daysAway: nearest.daysUntilLongTerm,
          date: nearest.longTermOn,
          taxSaved,
        };
      }
    }
  }

  return {
    isIraAccount: ira,
    washSale,
    shortTermGainLoss,
    longTermGainLoss,
    lotBreakdown,
    estimatedTax: {
      shortTermTax,
      longTermTax,
      total: shortTermTax + longTermTax,
      shortTermRate: stRate,
      longTermRate: ltRate,
    },
    shortTermWarning,
    longTermCountdown,
  };
}
