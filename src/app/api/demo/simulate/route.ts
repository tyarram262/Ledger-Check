import { NextResponse } from "next/server";
import { parseTradeBody } from "@/lib/tradeContext";
import { simulateTrade } from "@/lib/simulate";
import { DEFAULT_ELEVATED_THRESHOLD } from "@/lib/concentration";
import { DEFAULT_TAX_PROFILE } from "@/lib/taxRates";
import { demoContext } from "@/lib/demoPortfolio";
import { todayIso } from "@/lib/dates";

/**
 * Public, unauthenticated twin of `/api/simulate` for the `/demo` page (see
 * `src/lib/supabase/proxy.ts`'s `PUBLIC_PATHS`). Runs the SAME deterministic
 * `simulateTrade` engine the real app uses — this is what makes the demo a
 * real product tour rather than a mockup — but against the fixture portfolio
 * in `demoPortfolio.ts` instead of the authenticated user's own data.
 *
 * Deliberately does NOT go through `runSimulation` (`tradeContext.ts`) —
 * that helper is explicitly the RLS-scoped, cookie-authenticated path. This
 * route only ever reads the hardcoded fixture, never the database.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = parseTradeBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.errors.join(" ") }, { status: 400 });
  }

  const { accounts, lots, sales, prices } = demoContext();
  const outcome = simulateTrade(
    parsed.trade,
    lots,
    sales,
    accounts,
    todayIso(),
    prices,
    DEFAULT_ELEVATED_THRESHOLD,
    DEFAULT_TAX_PROFILE
  );
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: 400 });
  }
  return NextResponse.json(outcome.result);
}
