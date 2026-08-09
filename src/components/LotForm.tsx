"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Account } from "@/lib/types";
import { resolveAccountId } from "@/lib/accounts";
import TickerHint from "@/components/TickerHint";
import JournalPrompt, { type JournalPromptTarget } from "@/components/JournalPrompt";

export default function LotForm({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? 0);
  // `router.refresh()` re-renders this component with fresh `accounts` but
  // preserves its state, so `accountId` can point at an account that didn't
  // exist yet when this form mounted — see `resolveAccountId`'s doc comment.
  const selectedAccountId = resolveAccountId(accounts, accountId);
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [costPerShare, setCostPerShare] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [journalTarget, setJournalTarget] = useState<JournalPromptTarget | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/lots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: selectedAccountId,
        ticker,
        shares: Number(shares),
        costPerShare: Number(costPerShare),
        purchaseDate,
      }),
    });
    setPending(false);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.error ?? "Something went wrong.");
      return;
    }
    // Snapshot the entered values before clearing them — the journal
    // prompt's header needs them after the form resets.
    setJournalTarget({
      lotId: body.id,
      ticker: ticker.toUpperCase(),
      shares: Number(shares),
      costPerShare: Number(costPerShare),
      purchaseDate,
    });
    setTicker("");
    setShares("");
    setCostPerShare("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Account</span>
          <select
            value={selectedAccountId}
            onChange={(e) => setAccountId(Number(e.target.value))}
            className="rounded border border-slate-300 bg-white px-2 py-1.5"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Ticker</span>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="AAPL"
            required
            className="rounded border border-slate-300 px-2 py-1.5 uppercase"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Shares</span>
          <input
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            type="number"
            step="any"
            min="0"
            placeholder="10"
            required
            className="rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Cost / share ($)</span>
          <input
            value={costPerShare}
            onChange={(e) => setCostPerShare(e.target.value)}
            type="number"
            step="any"
            min="0"
            placeholder="185.50"
            required
            className="rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Purchase date</span>
          <input
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
            type="date"
            max={today}
            required
            className="rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
      </div>
      <TickerHint ticker={ticker} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending || accounts.length === 0}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add holding"}
      </button>
      </form>
      {journalTarget && (
        <JournalPrompt
          target={journalTarget}
          source="manual"
          onDone={() => setJournalTarget(null)}
        />
      )}
    </div>
  );
}
