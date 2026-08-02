import {
  getSettings,
  listAccounts,
  listLots,
  upsertHealthSnapshot,
  listHealthSnapshots,
  type HealthSnapshotRow,
} from "@/lib/queries";
import { getStoredQuotes, toPriceMap } from "@/lib/quotes";
import { buildPositions } from "@/lib/valuation";
import { sectorAllocation } from "@/lib/concentration";
import { lookThroughPositions } from "@/lib/etfOverlap";
import { portfolioHealth, type HealthScore } from "@/lib/scores";
import { todayIso } from "@/lib/dates";
import type { TaxProfile } from "@/lib/taxRates";

export interface HealthResult {
  health: HealthScore;
  history: HealthSnapshotRow[];
}

/**
 * Computes today's Portfolio Health Score (Feature 3) from the user's
 * current holdings, upserts a snapshot for today, and returns it alongside
 * recent history for a trend view. A second call the same day updates
 * today's row rather than creating a duplicate — see `upsertHealthSnapshot`.
 */
export async function computeAndPersistHealth(): Promise<HealthResult> {
  const [lots, accounts, settings] = await Promise.all([
    listLots(),
    listAccounts(),
    getSettings(),
  ]);

  const tickers = [...new Set(lots.map((l) => l.ticker))];
  const quotes = await getStoredQuotes(tickers);
  const prices = toPriceMap(quotes);

  const positions = buildPositions(lots, prices);
  const slices = sectorAllocation(positions);
  const lookThrough = lookThroughPositions(positions);
  const cash = accounts.reduce((sum, a) => sum + a.cashBalance, 0);
  const totalValue = positions.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  const today = todayIso();

  const profile: TaxProfile = {
    filingStatus: settings.filingStatus,
    annualTaxableIncome: settings.annualTaxableIncome,
    stateTaxRate: settings.stateTaxRate,
  };

  const health = portfolioHealth(
    lookThrough,
    slices,
    settings.concentrationThreshold,
    lots,
    prices,
    accounts,
    profile,
    cash,
    totalValue,
    today
  );

  const byKey = Object.fromEntries(health.subScores.map((s) => [s.key, s.score]));
  await upsertHealthSnapshot({
    snapshotDate: today,
    overall: health.overall,
    diversification: byKey.diversification,
    taxEfficiency: byKey.taxEfficiency,
    concentration: byKey.concentration,
    sectorBalance: byKey.sectorBalance,
    cashAllocation: byKey.cashAllocation,
  });

  const history = await listHealthSnapshots(30);
  return { health, history };
}
