import { addDays, daysBetween } from "@/lib/dates";

/**
 * IRS holding-period rule: a gain/loss is long-term only when the security
 * was held for *more than* one year — i.e. the sale happens on day 366 or
 * later (day 365 itself is still short-term). `daysBetween` returns whole
 * days, so "more than 365 days" is the correct boundary, not ">= 365".
 */
export const LONG_TERM_DAYS = 365;

export type HoldingTerm = "short" | "long";

/** Classifies a disposal as short- or long-term based on days held. */
export function termFor(purchaseDate: string, saleDate: string): HoldingTerm {
  return daysBetween(purchaseDate, saleDate) > LONG_TERM_DAYS ? "long" : "short";
}

/** First calendar date on which selling this lot would be long-term. */
export function longTermOn(purchaseDate: string): string {
  return addDays(purchaseDate, LONG_TERM_DAYS + 1);
}

/** Days remaining until this lot crosses into long-term, as of `today`. 0 if already long-term. */
export function daysUntilLongTerm(purchaseDate: string, today: string): number {
  return Math.max(0, daysBetween(today, longTermOn(purchaseDate)));
}
