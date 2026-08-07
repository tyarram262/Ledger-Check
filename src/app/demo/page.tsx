import Link from "next/link";
import { ACCOUNT_TYPE_LABELS } from "@/lib/types";
import { formatUsd } from "@/lib/format";
import { demoContext } from "@/lib/demoPortfolio";
import { buildPositions } from "@/lib/valuation";
import TradeSimulator from "@/components/TradeSimulator";

export const metadata = {
  title: "Live demo — Ledger Check",
  description:
    "Try the real wash-sale and concentration engine on a sample portfolio — no signup required.",
};

export default function DemoPage() {
  const { accounts, lots } = demoContext();
  // No price map passed — `buildPositions` falls back to cost basis, so
  // this static summary matches what the trade form shows before a
  // simulation runs (the actual simulation uses DEMO_PRICES).
  const positions = buildPositions(lots, new Map<string, number>());
  const totalValue = positions.reduce((sum, p) => sum + p.value, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Live demo</h1>
        <p className="mt-1 text-sm text-slate-500">
          This is a sample portfolio, not your data — no sign-in, nothing
          saved. Run the pre-filled trade below to see the exact panels a
          signed-in user sees, including the case a single-broker view can&apos;t
          catch: repurchasing in an IRA after a loss sale in a taxable account.
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">Sample portfolio</h2>
        <p className="mt-1 text-xs text-slate-400">
          Total value {formatUsd(totalValue)} at cost basis, across{" "}
          {accounts.length} accounts.
        </p>
        <ul className="mt-3 grid gap-4 sm:grid-cols-2">
          {accounts.map((a) => (
            <li key={a.id}>
              <p className="text-sm font-medium">
                {a.name}{" "}
                <span className="text-xs font-normal text-slate-400">
                  {ACCOUNT_TYPE_LABELS[a.type]}
                </span>
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                {lots
                  .filter((l) => l.accountId === a.id)
                  .map((l) => (
                    <li key={l.id}>
                      {l.shares} {l.ticker} @ {formatUsd(l.costPerShare)}
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          Also on record: a 25-share NVDA sale at a loss in the Taxable
          Brokerage account within the last 30 days — the fact that makes the
          pre-filled trade below trigger a wash sale.
        </p>
      </section>

      <TradeSimulator accounts={accounts} demo />

      <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">
        Ready to check your own portfolio?{" "}
        <Link href="/login" className="font-medium underline">
          Sign in
        </Link>{" "}
        — free while in beta.
      </div>
    </div>
  );
}
