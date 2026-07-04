"use client";

import { lookupSecurity } from "@/lib/sectors";

export default function TickerHint({ ticker }: { ticker: string }) {
  const trimmed = ticker.trim();
  if (trimmed.length === 0) return null;

  const info = lookupSecurity(trimmed);
  if (!info) {
    return (
      <p className="text-xs text-amber-600">
        {trimmed.toUpperCase()} isn&apos;t in the sector map yet — it will show
        as &ldquo;Unmapped&rdquo; on the dashboard.
      </p>
    );
  }
  return (
    <p className="text-xs text-slate-500">
      {info.name} · {info.sector}
      {info.isEtf && " · ETF (mapped by primary tilt)"}
    </p>
  );
}
