"use client";

import type { OverlapResult } from "@/lib/etfOverlap";
import { formatUsd } from "@/lib/format";

export default function OverlapPanel({ overlap }: { overlap: OverlapResult }) {
  const hasSomethingToShow =
    overlap.contributors.length > 0 ||
    overlap.etfOverlaps.length > 0 ||
    overlap.unmappedEtfs.length > 0;

  if (!hasSomethingToShow) return null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="text-base font-semibold">Fund overlap</h3>
      <p className="mt-2 text-sm text-slate-600">{overlap.sentence}</p>

      {overlap.contributors.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-slate-500">
          {overlap.contributors.map((c) => (
            <li key={c.viaEtf}>
              {c.viaEtf}: {c.etfWeightPct.toFixed(1)}% of the fund (~{formatUsd(c.dollarValue)} of your exposure)
            </li>
          ))}
        </ul>
      )}

      {overlap.etfOverlaps.length > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          Substantial overlap with funds you already hold:{" "}
          {overlap.etfOverlaps
            .map((o) => `${o.ticker} (~${Math.round(o.sharedWeightPct)}% shared holdings)`)
            .join(", ")}
          .
        </p>
      )}

      {overlap.unmappedEtfs.length > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          No overlap data for {overlap.unmappedEtfs.join(", ")} — holdings
          aren&apos;t modeled for {overlap.unmappedEtfs.length > 1 ? "these funds" : "this fund"}.
        </p>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Based on a static top-holdings snapshot for each fund, not live data —
        an approximation, not exact.
      </p>
    </section>
  );
}
