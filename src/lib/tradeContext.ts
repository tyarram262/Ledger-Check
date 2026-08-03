import { getSettings, listAccounts, listLots, listSales } from "@/lib/queries";
import { getStoredQuotes, toPriceMap } from "@/lib/quotes";
import { simulateTrade, type SimulationOutcome } from "@/lib/simulate";
import type { SimulatedTrade } from "@/lib/washSale";
import type { TaxProfile } from "@/lib/taxRates";
import { todayIso } from "@/lib/dates";

const TICKER_PATTERN = /^[A-Za-z.\-]{1,10}$/;

/**
 * Parses and validates a raw trade request body. Shared by every route that
 * accepts a trade payload (`/api/simulate`, `/api/trade-review`) so ticker/
 * shares/price validation can't drift between them.
 */
export function parseTradeBody(
  body: unknown
): { ok: true; trade: SimulatedTrade } | { ok: false; errors: string[] } {
  const b = body as Record<string, unknown> | null;
  const side = b?.side;
  const ticker = typeof b?.ticker === "string" ? b.ticker.trim() : "";
  const shares = Number(b?.shares);
  const pricePerShare = Number(b?.pricePerShare);
  const accountId = b?.accountId ? Number(b.accountId) : undefined;

  const errors: string[] = [];
  if (side !== "buy" && side !== "sell") errors.push("Side must be buy or sell.");
  if (!TICKER_PATTERN.test(ticker)) errors.push("Invalid ticker.");
  if (!Number.isFinite(shares) || shares <= 0) errors.push("Shares must be a positive number.");
  if (!Number.isFinite(pricePerShare) || pricePerShare <= 0)
    errors.push("Price must be a positive number.");
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    trade: { side: side as "buy" | "sell", ticker, shares, pricePerShare, accountId },
  };
}

/**
 * Loads every input `simulateTrade` needs for the *authenticated session's
 * own* RLS-scoped rows and runs the deterministic simulation. This is the
 * ONLY place trade context is assembled — a 2026-08 regression shipped
 * because `/api/simulate/route.ts` called `simulateTrade` without fetching
 * the user's tax profile from `/settings`, so every Tax Check estimate
 * silently used the single-filer/$0-income default regardless of what the
 * user configured. Routes that need a simulated trade (currently
 * `/api/simulate` and `/api/trade-review`) both call this instead of
 * re-assembling the inputs themselves.
 */
export async function runSimulation(trade: SimulatedTrade): Promise<SimulationOutcome> {
  const [lots, sales, accounts, settings] = await Promise.all([
    listLots(),
    listSales(),
    listAccounts(),
    getSettings(),
  ]);
  const prices = toPriceMap(await getStoredQuotes([...new Set(lots.map((l) => l.ticker))]));
  const profile: TaxProfile = {
    filingStatus: settings.filingStatus,
    annualTaxableIncome: settings.annualTaxableIncome,
    stateTaxRate: settings.stateTaxRate,
  };

  return simulateTrade(
    trade,
    lots,
    sales,
    accounts,
    todayIso(),
    prices,
    settings.concentrationThreshold,
    profile
  );
}
