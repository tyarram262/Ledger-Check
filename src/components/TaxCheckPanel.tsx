"use client";

import type { TaxCheckResult } from "@/lib/taxCheck";
import { formatUsd } from "@/lib/format";

/**
 * Renders short-term warning -> long-term countdown -> estimated tax, in
 * that order (least to most "give it time"). The wash-sale warning itself
 * is rendered separately, above this panel, by `TradeSimulator` — this
 * panel doesn't repeat it.
 */
export default function TaxCheckPanel({ taxCheck }: { taxCheck: TaxCheckResult }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="text-base font-semibold">Tax check</h3>

      {taxCheck.isIraAccount ? (
        <p className="mt-2 text-sm text-slate-500">
          This account is an IRA — a sell inside it has no current-year tax
          consequence, so no estimate is shown here.
        </p>
      ) : (
        <>
          {taxCheck.shortTermWarning && (
            <p className="mt-2 text-sm text-amber-700">{taxCheck.shortTermWarning}</p>
          )}

          {taxCheck.longTermCountdown && (
            <p className="mt-2 text-sm text-sky-700">
              Wait {taxCheck.longTermCountdown.daysAway} more day
              {taxCheck.longTermCountdown.daysAway === 1 ? "" : "s"} (until{" "}
              {taxCheck.longTermCountdown.date}) for {taxCheck.longTermCountdown.shares} of
              those shares to become long-term — an estimated{" "}
              {formatUsd(taxCheck.longTermCountdown.taxSaved)} in tax savings.
            </p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-slate-400">Short-term gain/loss</p>
              <p
                className={
                  taxCheck.shortTermGainLoss < 0
                    ? "font-medium text-red-600"
                    : "font-medium text-slate-800"
                }
              >
                {formatUsd(taxCheck.shortTermGainLoss)}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Long-term gain/loss</p>
              <p
                className={
                  taxCheck.longTermGainLoss < 0
                    ? "font-medium text-red-600"
                    : "font-medium text-slate-800"
                }
              >
                {formatUsd(taxCheck.longTermGainLoss)}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Est. tax owed</p>
              <p className="font-medium text-slate-800">{formatUsd(taxCheck.estimatedTax.total)}</p>
            </div>
            <div>
              <p className="text-slate-400">Rates used</p>
              <p className="font-medium text-slate-800">
                {taxCheck.estimatedTax.shortTermRate.toFixed(1)}% ST /{" "}
                {taxCheck.estimatedTax.longTermRate.toFixed(1)}% LT
              </p>
            </div>
          </div>
        </>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Estimate only — not tax advice. A marginal-rate approximation from
        the tax profile in your settings; doesn&apos;t model AMT, other
        income, or anything beyond a flat state rate.
      </p>
    </section>
  );
}
