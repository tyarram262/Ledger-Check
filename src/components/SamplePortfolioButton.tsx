"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * One-click zero-state unblock: seeds a realistic two-account sample
 * portfolio via `POST /api/sample-portfolio` (see `samplePortfolio.ts`),
 * removable later via `SampleDataBanner`. Mounted on `/holdings` and `/`
 * only while the signed-in user has zero accounts — see CLAUDE.md's Phase 4
 * slice 2 (first-run trap).
 */
export default function SamplePortfolioButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    const res = await fetch("/api/sample-portfolio", { method: "POST" });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Loading…" : "Load a sample portfolio"}
      </button>
      <p className="text-xs text-slate-500">
        Two accounts, six holdings, and one loss sale — enough to see a real
        health score and wash-sale check. Remove it any time.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
