import Link from "next/link";
import { getConcentrationThreshold, listLots } from "@/lib/queries";
import {
  concentrationVerdict,
  sectorAllocation,
  type ConcentrationLevel,
} from "@/lib/concentration";
import { lookupSecurity } from "@/lib/sectors";
import { formatUsd } from "@/lib/format";
import { getStoredQuotes, toPriceMap } from "@/lib/quotes";
import { buildPositions, splitPricedTickers } from "@/lib/valuation";
import { createClient } from "@/lib/supabase/server";
import SectorChart from "@/components/SectorChart";
import DigestCard from "@/components/DigestCard";
import RefreshPricesButton from "@/components/RefreshPricesButton";
import HealthScoreCard from "@/components/HealthScoreCard";
import Landing from "@/components/Landing";

export const dynamic = "force-dynamic";

const LEVEL_STYLES: Record<ConcentrationLevel, string> = {
  diversified: "border-emerald-200 bg-emerald-50 text-emerald-800",
  elevated: "border-amber-200 bg-amber-50 text-amber-800",
  high: "border-red-200 bg-red-50 text-red-800",
};

export default async function DashboardPage() {
  // `/` is public (see `PUBLIC_PATHS` in `src/lib/supabase/proxy.ts`) so a
  // signed-out visitor lands here instead of being redirected to `/login`.
  // Same getClaims() call `layout.tsx` already makes for the nav.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return <Landing />;
  }

  const lots = await listLots();
  const quotes = await getStoredQuotes([...new Set(lots.map((l) => l.ticker))]);
  const prices = toPriceMap(quotes);
  const positions = buildPositions(lots, prices);
  const { priced, unpriced } = splitPricedTickers(lots, prices);
  const oldestFetch = [...quotes.values()]
    .map((q) => q.fetchedAt)
    .sort()[0];
  const slices = sectorAllocation(positions);
  const verdict = concentrationVerdict(slices, await getConcentrationThreshold());
  const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
  const hasEtf = lots.some((l) => lookupSecurity(l.ticker)?.isEtf);
  const hasUnmapped = lots.some((l) => !lookupSecurity(l.ticker));

  if (lots.length === 0) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome to Ledger Check
        </h1>
        <p className="mt-3 text-sm text-slate-500">
          Get a plain-English gut check on sector concentration and wash-sale
          risk before you place a trade. Start by entering what you own.
        </p>
        <Link
          href="/holdings"
          className="mt-6 inline-block rounded bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          Add your holdings
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <div className="flex flex-wrap items-baseline gap-3">
          <p className="text-sm text-slate-500">
            Portfolio total: {formatUsd(totalValue)}
            <span className="ml-1 text-xs text-slate-400">
              {priced.length === 0
                ? "(at cost basis — refresh to fetch live prices)"
                : unpriced.length === 0
                  ? `(live prices as of ${new Date(oldestFetch!).toLocaleString()})`
                  : `(${priced.length} of ${priced.length + unpriced.length} tickers at live prices; ${unpriced.join(", ")} at cost)`}
            </span>
          </p>
          <RefreshPricesButton />
        </div>
      </div>

      <HealthScoreCard />

      <div
        className={`rounded-lg border px-5 py-4 text-base font-medium ${LEVEL_STYLES[verdict.level]}`}
      >
        {verdict.sentence}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold">Sector allocation</h2>
          <SectorChart slices={slices} />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold">Breakdown</h2>
          <ul className="mt-3 space-y-3">
            {slices.map((s) => (
              <li key={s.sector}>
                <div className="flex justify-between text-sm">
                  <span>{s.sector}</span>
                  <span className="text-slate-500">
                    {formatUsd(s.value)} · {s.pct.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-slate-700"
                    style={{ width: `${Math.min(s.pct, 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <DigestCard />

      {(hasEtf || hasUnmapped) && (
        <div className="space-y-1 text-xs text-slate-400">
          {hasEtf && (
            <p>
              ETFs are mapped to a single &ldquo;primary tilt&rdquo; sector (or
              Diversified for broad-market funds) — not a true holding-level
              look-through, so sector percentages are approximate.
            </p>
          )}
          {hasUnmapped && (
            <p>
              Some tickers aren&apos;t in the local sector map yet and appear
              as &ldquo;Unmapped.&rdquo;
            </p>
          )}
        </div>
      )}
    </div>
  );
}
