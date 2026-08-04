import { NextResponse } from "next/server";
import { isSnapTradeConfigured } from "@/lib/brokerage/sync";

/**
 * Shared response helpers for the `/api/brokerage/*` routes — a leading
 * underscore excludes this file from Next's route matching. Every route
 * but `status` (which reports "not configured" as data rather than an
 * error) repeats the same config guard and error-to-JSON mapping, so it's
 * factored here instead of copy-pasted four times.
 */

/** 501s every brokerage route when SnapTrade sync isn't configured
 *  (`SNAPTRADE_CLIENT_ID`/`SNAPTRADE_CONSUMER_KEY` unset) — returns
 *  `null` when the route should proceed. */
export function requireSnapTradeConfigured(): NextResponse | null {
  if (isSnapTradeConfigured()) return null;
  return NextResponse.json({ error: "Brokerage sync isn't configured." }, { status: 501 });
}

export function brokerageError(err: unknown, status: number, fallback: string): NextResponse {
  return NextResponse.json({ error: err instanceof Error ? err.message : fallback }, { status });
}
