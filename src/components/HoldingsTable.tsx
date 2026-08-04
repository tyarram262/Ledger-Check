"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Lot } from "@/lib/types";
import type { JournalEntry } from "@/lib/journal";
import { lookupSecurity, UNMAPPED_SECTOR } from "@/lib/sectors";
import { formatShares, formatUsd } from "@/lib/format";
import JournalEntryDetail from "@/components/JournalEntryDetail";

export default function HoldingsTable({
  lots,
  entries,
}: {
  lots: Lot[];
  entries: JournalEntry[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const entryByLot = useMemo(
    () => new Map(entries.filter((e) => e.lotId != null).map((e) => [e.lotId as number, e])),
    [entries]
  );

  async function handleDelete(id: number) {
    await fetch(`/api/lots/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function handleDeleteNote(id: number) {
    await fetch(`/api/journal/${id}`, { method: "DELETE" });
    router.refresh();
  }

  function toggleExpanded(lotId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(lotId)) next.delete(lotId);
      else next.add(lotId);
      return next;
    });
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
            const entry = entryByLot.get(lot.id);
            const isExpanded = expanded.has(lot.id);
            return (
              <Fragment key={lot.id}>
                <tr className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-medium">
                    {lot.ticker}
                    {info?.isEtf && (
                      <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                        ETF
                      </span>
                    )}
                    {entry && (
                      <button
                        onClick={() => toggleExpanded(lot.id)}
                        aria-label={isExpanded ? "Hide journal note" : "Show journal note"}
                        className="ml-1.5 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-700 hover:bg-sky-200"
                      >
                        note {isExpanded ? "▲" : "▼"}
                      </button>
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
                  <td className="py-2 pr-3 text-slate-600">
                    {lot.purchaseDate ?? (
                      <span
                        className="text-amber-600"
                        title="Synced from your brokerage with limited transaction history — excluded from wash-sale and holding-period checks."
                      >
                        Unknown
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => handleDelete(lot.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
                {entry && isExpanded && (
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <td colSpan={8} className="px-3 py-3">
                      <JournalEntryDetail entry={entry} onDelete={handleDeleteNote} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
