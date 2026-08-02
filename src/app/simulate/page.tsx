import Link from "next/link";
import { listAccounts, listLots } from "@/lib/queries";
import TradeSimulator from "@/components/TradeSimulator";

export const dynamic = "force-dynamic";

export default async function SimulatePage() {
  const accounts = await listAccounts();
  const hasHoldings = (await listLots()).length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Trade check
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Gut-check a trade before you place it: sector concentration, fund
          overlap, and diversification/risk impact on buys — plus wash-sale
          risk and an estimated tax hit on sells — across all your accounts,
          including IRAs.
        </p>
      </div>

      {!hasHoldings && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          You haven&apos;t entered any holdings yet, so the check will treat
          this trade as your entire portfolio.{" "}
          <Link href="/holdings" className="font-medium underline">
            Add holdings first
          </Link>{" "}
          for a meaningful result.
        </div>
      )}

      <TradeSimulator accounts={accounts} />
    </div>
  );
}
