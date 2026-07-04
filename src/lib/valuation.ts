import type { Lot } from "@/lib/types";
import type { Position } from "@/lib/concentration";

/** Position values for allocation math: live price when we have one,
 *  falling back to the lot's cost basis. */
export function buildPositions(
  lots: Lot[],
  prices: Map<string, number>
): Position[] {
  return lots.map((l) => ({
    ticker: l.ticker,
    value: l.shares * (prices.get(l.ticker) ?? l.costPerShare),
  }));
}

export function splitPricedTickers(
  lots: Lot[],
  prices: Map<string, number>
): { priced: string[]; unpriced: string[] } {
  const tickers = [...new Set(lots.map((l) => l.ticker))];
  return {
    priced: tickers.filter((t) => prices.has(t)),
    unpriced: tickers.filter((t) => !prices.has(t)),
  };
}
