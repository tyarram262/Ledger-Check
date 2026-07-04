"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RefreshPricesButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleRefresh() {
    setPending(true);
    setStatus(null);
    const res = await fetch("/api/quotes/refresh", { method: "POST" });
    const body = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok || !body) {
      setStatus("Refresh failed — try again.");
      return;
    }
    setStatus(
      body.failed.length === 0
        ? `Updated ${body.updated.length} tickers.`
        : `Updated ${body.updated.length}; no quote for ${body.failed.join(", ")}.`
    );
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={handleRefresh}
        disabled={pending}
        className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
      >
        {pending ? "Fetching…" : "Refresh prices"}
      </button>
      {status && <span className="text-xs text-slate-400">{status}</span>}
    </span>
  );
}
