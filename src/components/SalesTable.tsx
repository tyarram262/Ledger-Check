"use client";

import { useRouter } from "next/navigation";
import type { Sale } from "@/lib/types";
import { formatShares, formatUsd } from "@/lib/format";

export default function SalesTable({ sales }: { sales: Sale[] }) {
  const router = useRouter();

  async function handleDelete(id: number) {
    await fetch(`/api/sales/${id}`, { method: "DELETE" });
    router.refresh();
  }

  if (sales.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No past sales recorded. Add any sales from the last ~60 days so the
        wash-sale check has history to work with.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3">Ticker</th>
            <th className="py-2 pr-3">Account</th>
            <th className="py-2 pr-3 text-right">Shares</th>
            <th className="py-2 pr-3 text-right">Sale price</th>
            <th className="py-2 pr-3 text-right">Cost basis</th>
            <th className="py-2 pr-3 text-right">Gain / loss</th>
            <th className="py-2 pr-3">Sold</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {sales.map((sale) => (
            <tr key={sale.id} className="border-b border-slate-100">
              <td className="py-2 pr-3 font-medium">{sale.ticker}</td>
              <td className="py-2 pr-3 text-slate-600">{sale.accountName}</td>
              <td className="py-2 pr-3 text-right">
                {formatShares(sale.shares)}
              </td>
              <td className="py-2 pr-3 text-right">
                {formatUsd(sale.salePricePerShare)}
              </td>
              <td className="py-2 pr-3 text-right">
                {formatUsd(sale.costPerShare)}
              </td>
              <td
                className={`py-2 pr-3 text-right font-medium ${
                  sale.realizedGainLoss < 0
                    ? "text-red-600"
                    : "text-emerald-600"
                }`}
              >
                {formatUsd(sale.realizedGainLoss)}
              </td>
              <td className="py-2 pr-3 text-slate-600">{sale.saleDate}</td>
              <td className="py-2 text-right">
                <button
                  onClick={() => handleDelete(sale.id)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
