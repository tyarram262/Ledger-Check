"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Shown wherever any account has `isSample: true` — makes clear the data on
 * screen isn't the user's own, and offers a way out. Pairs with
 * `SamplePortfolioButton`; see CLAUDE.md's Phase 4 slice 2.
 */
export default function SampleDataBanner() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRemove() {
    setPending(true);
    setError(null);
    const res = await fetch("/api/sample-portfolio", { method: "DELETE" });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
      <span>
        You&apos;re looking at a sample portfolio, not your own data.
        {error && <span className="ml-2 text-red-600">{error}</span>}
      </span>
      <button
        type="button"
        onClick={handleRemove}
        disabled={pending}
        className="rounded border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
      >
        {pending ? "Removing…" : "Remove sample data"}
      </button>
    </div>
  );
}
