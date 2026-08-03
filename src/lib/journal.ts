import { addMonths, daysBetween } from "@/lib/dates";

export type TimeHorizon = "under_1y" | "1_3y" | "3_10y" | "10y_plus" | "indefinite";

/** `months` is the point at which the stated horizon has definitely
 *  elapsed. `10y_plus` is a floor, not an equality — the UI copy should
 *  read "at least 10 years," not "exactly 10 years." `indefinite` has no
 *  review date at all. */
export const TIME_HORIZONS: { value: TimeHorizon; label: string; months: number | null }[] = [
  { value: "under_1y", label: "Less than a year", months: 12 },
  { value: "1_3y", label: "1-3 years", months: 36 },
  { value: "3_10y", label: "3-10 years", months: 120 },
  { value: "10y_plus", label: "10+ years", months: 120 },
  { value: "indefinite", label: "No set horizon", months: null },
];

export function horizonLabel(h: TimeHorizon): string {
  return TIME_HORIZONS.find((t) => t.value === h)?.label ?? h;
}

/** Earliest date at which the stated horizon has elapsed, or null when
 *  the horizon is indefinite (nothing to review against). */
export function horizonReviewDate(purchaseDate: string, h: TimeHorizon): string | null {
  const months = TIME_HORIZONS.find((t) => t.value === h)?.months ?? null;
  return months == null ? null : addMonths(purchaseDate, months);
}

export interface JournalEntry {
  id: number;
  lotId: number | null;
  ticker: string;
  accountId: number | null;
  shares: number | null;
  costPerShare: number | null;
  purchaseDate: string;
  reason: string;
  timeHorizon: TimeHorizon;
  horizonReviewDate: string | null;
  sellTrigger: string | null;
  risks: string | null;
  aiReview: string | null;
  source: "manual" | "simulator";
  createdAt: string;
}

/** True once `today` has reached the entry's horizon review date (always
 *  false for an indefinite horizon, which has no review date to reach). */
export function isPastHorizon(entry: JournalEntry, today: string): boolean {
  if (!entry.horizonReviewDate) return false;
  return daysBetween(today, entry.horizonReviewDate) <= 0;
}
