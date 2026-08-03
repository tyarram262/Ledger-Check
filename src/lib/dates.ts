/** Date helpers for ISO date strings (YYYY-MM-DD), computed in UTC to avoid
 *  timezone drift around midnight. */

export function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Adds calendar months (not a days-per-month approximation). Rolling past
 *  a shorter month clamps to that month's last day (e.g. Jan 31 + 1 month
 *  -> Feb 28/29, not Mar 3), matching `Date`'s UTC month-arithmetic behavior. */
export function addMonths(iso: string, months: number): string {
  const d = parseIsoDate(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1); // avoid month-end overflow while shifting the month
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDayOfMonth));
  return toIsoDate(d);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const ms = parseIsoDate(to).getTime() - parseIsoDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

export function todayIso(): string {
  return toIsoDate(new Date());
}
