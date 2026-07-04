"use client";

import { useRouter } from "next/navigation";
import type { Lot } from "@/lib/types";
import { lookupSecurity, UNMAPPED_SECTOR } from "@/lib/sectors";
import { formatShares, formatUsd } from "@/lib/format";

export default function HoldingsTable({ lots }: { lots: Lot[] }) {
  const router = useRouter();

  async function handleDelete(id: number) {
    await fetch(`/api/lots/${id}`, { method: "DELETE" });
    router.refresh();
  }

  if (lots.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No holdings yet — add your first lot above.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3">Ticker</th>
            <th className="py-2 pr-3">Sector</th>
            <th className="py-2 pr-3">Account</th>
            <th className="py-2 pr-3 text-right">Shares</th>
            <th className="py-2 pr-3 text-right">Cost / share</th>
            <th className="py-2 pr-3 text-right">Total cost</th>
            <th className="py-2 pr-3">Purchased</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {lots.map((lot) => {
            const info = lookupSecurity(lot.ticker);
            return (
              <tr key={lot.id} className="border-b border-slate-100">
                <td className="py-2 pr-3 font-medium">
                  {lot.ticker}
                  {info?.isEtf && (
                    <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                      ETF
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-slate-600">
                  {info?.sector ?? UNMAPPED_SECTOR}
                </td>
                <td className="py-2 pr-3 text-slate-600">{lot.accountName}</td>
                <td className="py-2 pr-3 text-right">
                  {formatShares(lot.shares)}
                </td>
                <td className="py-2 pr-3 text-right">
                  {formatUsd(lot.costPerShare)}
                </td>
                <td className="py-2 pr-3 text-right">
                  {formatUsd(lot.shares * lot.costPerShare)}
                </td>
                <td className="py-2 pr-3 text-slate-600">{lot.purchaseDate}</td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => handleDelete(lot.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
