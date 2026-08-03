"use client";

import { useState } from "react";
import { TIME_HORIZONS, type TimeHorizon } from "@/lib/journal";
import { formatShares, formatUsd } from "@/lib/format";

export interface JournalPromptTarget {
  lotId: number;
  ticker: string;
  shares: number;
  costPerShare: number;
  purchaseDate: string;
}

export default function JournalPrompt({
  target,
  defaultReason = "",
  aiReview = null,
  source,
  onDone,
}: {
  target: JournalPromptTarget;
  defaultReason?: string;
  aiReview?: string | null;
  source: "manual" | "simulator";
  onDone: () => void;
}) {
  const [reason, setReason] = useState(defaultReason);
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizon | "">("");
  const [sellTrigger, setSellTrigger] = useState("");
  const [risks, setRisks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!timeHorizon) {
      setError("Pick a time horizon.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await fetch("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lotId: target.lotId,
        reason,
        timeHorizon,
        sellTrigger: sellTrigger || null,
        risks: risks || null,
        aiReview,
        source,
      }),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Something went wrong.");
      return;
    }
    onDone();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="text-base font-semibold">
        You bought {formatShares(target.shares)} {target.ticker} at{" "}
        {formatUsd(target.costPerShare)}/share. Why?
      </h3>
      <p className="mt-1 text-sm text-slate-500">
        Optional, but future-you will thank present-you — this gets saved next to the
        position so you can check back against your own reasoning later.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Why are you buying this?</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. Long-term AI growth, dividend income, value opportunity…"
            required
            className="rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:w-64">
          <span className="text-slate-600">Time horizon</span>
          <select
            value={timeHorizon}
            onChange={(e) => setTimeHorizon(e.target.value as TimeHorizon)}
            required
            className="rounded border border-slate-300 bg-white px-2 py-1.5"
          >
            <option value="" disabled>
              Pick one…
            </option>
            {TIME_HORIZONS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">What would make you sell? (optional)</span>
          <textarea
            value={sellTrigger}
            onChange={(e) => setSellTrigger(e.target.value)}
            rows={2}
            placeholder="e.g. Thesis breaks if revenue growth slows meaningfully…"
            className="rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">What risks concern you? (optional)</span>
          <textarea
            value={risks}
            onChange={(e) => setRisks(e.target.value)}
            rows={2}
            className="rounded border border-slate-300 px-2 py-1.5"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save note"}
          </button>
          <button
            type="button"
            onClick={onDone}
            disabled={pending}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Skip
          </button>
        </div>
      </form>
    </section>
  );
}
