import { addDays, daysBetween } from "@/lib/dates";

/**
 * IRS holding-period rule: a gain/loss is long-term only when the security
 * was held for *more than* one year — i.e. the sale happens on day 366 or
 * later (day 365 itself is still short-term). `daysBetween` returns whole
 * days, so "more than 365 days" is the correct boundary, not ">= 365".
 */
export const LONG_TERM_DAYS = 365;

/** "unknown" covers lots with no purchase date (e.g. a brokerage sync that
 *  couldn't reconstruct one — see `reconcileLots.ts`). It is deliberately
 *  its own term rather than defaulting to "short" or "long": either default
 *  would fabricate a tax classification the data doesn't support. */
export type HoldingTerm = "short" | "long" | "unknown";

/** Classifies a disposal as short- or long-term based on days held, or
 *  "unknown" when the lot has no recorded purchase date. */
export function termFor(purchaseDate: string | null, saleDate: string): HoldingTerm {
  if (purchaseDate === null) return "unknown";
  return daysBetween(purchaseDate, saleDate) > LONG_TERM_DAYS ? "long" : "short";
}

/** First calendar date on which selling this lot would be long-term, or
 *  `null` when the lot has no purchase date to count from. */
export function longTermOn(purchaseDate: string | null): string | null {
  if (purchaseDate === null) return null;
  return addDays(purchaseDate, LONG_TERM_DAYS + 1);
}

/** Days remaining until this lot crosses into long-term, as of `today`. 0 if
 *  already long-term; `null` when the lot has no purchase date. */
export function daysUntilLongTerm(purchaseDate: string | null, today: string): number | null {
  const target = longTermOn(purchaseDate);
  if (target === null) return null;
  return Math.max(0, daysBetween(today, target));
}
