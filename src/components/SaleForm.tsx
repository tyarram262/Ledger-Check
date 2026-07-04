"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Account } from "@/lib/types";
import TickerHint from "@/components/TickerHint";

export default function SaleForm({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? 0);
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [salePricePerShare, setSalePricePerShare] = useState("");
  const [costPerShare, setCostPerShare] = useState("");
  const [saleDate, setSaleDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const realized =
    shares && salePricePerShare && costPerShare
      ? (Number(salePricePerShare) - Number(costPerShare)) * Number(shares)
      : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        ticker,
        shares: Number(shares),
        salePricePerShare: Number(salePricePerShare),
        costPerShare: Number(costPerShare),
        saleDate,
      }),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Something went wrong.");
      return;
    }
    setTicker("");
    setShares("");
    setSalePricePerShare("");
    setCostPerShare("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Account</span>
          <select
            value={accountId}
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
            placeholder="NVDA"
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
            required
            className="rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Sale price / share ($)</span>
          <input
            value={salePricePerShare}
            onChange={(e) => setSalePricePerShare(e.target.value)}
            type="number"
            step="any"
            min="0"
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
            required
            className="rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Sale date</span>
          <input
            value={saleDate}
            onChange={(e) => setSaleDate(e.target.value)}
            type="date"
            max={today}
            required
            className="rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
      </div>
      <TickerHint ticker={ticker} />
      {realized !== null && (
        <p
          className={`text-xs ${realized < 0 ? "text-red-600" : "text-emerald-600"}`}
        >
          Realized {realized < 0 ? "loss" : "gain"}: $
          {Math.abs(realized).toFixed(2)}
          {realized < 0 &&
            " — loss sales power the wash-sale check in the trade simulator"}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending || accounts.length === 0}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Add past sale"}
      </button>
    </form>
  );
}
