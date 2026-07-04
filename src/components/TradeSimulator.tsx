"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Account } from "@/lib/types";
import type { SimulationResult, Severity } from "@/lib/simulate";
import { formatUsd } from "@/lib/format";
import TickerHint from "@/components/TickerHint";

const SEVERITY_STYLES: Record<Severity, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  caution: "border-amber-200 bg-amber-50 text-amber-800",
  warning: "border-red-200 bg-red-50 text-red-800",
};

interface MergedSlice {
  sector: string;
  beforePct: number;
  afterPct: number;
}

function mergeSlices(result: SimulationResult): MergedSlice[] {
  const sectors = new Map<string, MergedSlice>();
  for (const s of result.before.slices) {
    sectors.set(s.sector, { sector: s.sector, beforePct: s.pct, afterPct: 0 });
  }
  for (const s of result.after.slices) {
    const entry = sectors.get(s.sector) ?? {
      sector: s.sector,
      beforePct: 0,
      afterPct: 0,
    };
    entry.afterPct = s.pct;
    sectors.set(s.sector, entry);
  }
  return [...sectors.values()].sort((a, b) => b.afterPct - a.afterPct);
}

export default function TradeSimulator({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [pricePerShare, setPricePerShare] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? 0);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [recorded, setRecorded] = useState(false);

  const tradePayload = {
    side,
    ticker,
    shares: Number(shares),
    pricePerShare: Number(pricePerShare),
    accountId,
  };

  async function handleSimulate(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setRecorded(false);
    const res = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tradePayload),
    });
    setPending(false);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setResult(null);
      setError(body?.error ?? "Something went wrong.");
      return;
    }
    setResult(body);
  }

  async function handleRecord() {
    setPending(true);
    setError(null);
    const res = await fetch("/api/trades/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tradePayload),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Something went wrong.");
      return;
    }
    setRecorded(true);
    setResult(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSimulate}
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Side</span>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as "buy" | "sell")}
              className="rounded border border-slate-300 bg-white px-2 py-1.5"
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
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
            <span className="text-slate-600">Price / share ($)</span>
            <input
              value={pricePerShare}
              onChange={(e) => setPricePerShare(e.target.value)}
              type="number"
              step="any"
              min="0"
              required
              className="rounded border border-slate-300 px-2 py-1.5"
            />
          </label>
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
        </div>
        <div className="mt-2">
          <TickerHint ticker={ticker} />
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {recorded && (
          <p className="mt-2 text-sm text-emerald-600">
            Trade recorded — your holdings and sale history are updated.
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Checking…" : "Check this trade"}
        </button>
      </form>

      {result && (
        <div className="space-y-4">
          <div
            className={`rounded-lg border px-5 py-4 text-base font-medium ${SEVERITY_STYLES[result.severity]}`}
          >
            {result.verdictSentence}
          </div>

          {result.washSale && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-5">
              <h3 className="font-semibold text-red-800">
                Wash-sale warning
              </h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
                {result.washSale.triggers.map((t) => (
                  <li key={`${t.date}-${t.accountName}`}>
                    {t.date}: {t.description}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-red-700">
                The 30-day window clears on{" "}
                <strong>{result.washSale.windowClearsOn}</strong>. The IRS may
                disallow some or all of the loss depending on share counts —
                this check flags any match.
              </p>
            </div>
          )}

          {result.futureRebuyNote && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
              {result.futureRebuyNote}
            </div>
          )}

          {result.sellPreview && (
            <p className="text-sm text-slate-500">
              Selling {result.sellPreview.sharesSold} shares at an average cost
              basis of {formatUsd(result.sellPreview.avgCostPerShare)} realizes
              a{" "}
              <span
                className={
                  result.sellPreview.realizedGainLoss < 0
                    ? "font-medium text-red-600"
                    : "font-medium text-emerald-600"
                }
              >
                {formatUsd(result.sellPreview.realizedGainLoss)}{" "}
                {result.sellPreview.realizedGainLoss < 0 ? "loss" : "gain"}
              </span>{" "}
              (FIFO).
            </p>
          )}

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="text-base font-semibold">
              Sector allocation: before → after
            </h3>
            <ul className="mt-3 space-y-3">
              {mergeSlices(result).map((s) => {
                const delta = s.afterPct - s.beforePct;
                return (
                  <li key={s.sector}>
                    <div className="flex justify-between text-sm">
                      <span>{s.sector}</span>
                      <span className="text-slate-500">
                        {s.beforePct.toFixed(1)}% → {s.afterPct.toFixed(1)}%
                        {Math.abs(delta) >= 0.05 && (
                          <span
                            className={`ml-1.5 font-medium ${delta > 0 ? "text-amber-600" : "text-sky-600"}`}
                          >
                            ({delta > 0 ? "+" : ""}
                            {delta.toFixed(1)})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="relative mt-1 h-2 rounded-full bg-slate-100">
                      <div
                        className="absolute h-2 rounded-full bg-slate-300"
                        style={{ width: `${Math.min(s.beforePct, 100)}%` }}
                      />
                      <div
                        className="absolute h-2 rounded-full bg-slate-700 opacity-70"
                        style={{ width: `${Math.min(s.afterPct, 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-slate-400">
              Light bar = current, dark bar = after this trade. Values use
              live prices where available, otherwise cost basis.
            </p>
          </section>

          <p className="mt-2 text-sm text-slate-500">
            If you make this trade: {result.after.verdict.sentence}
          </p>

          <button
            onClick={handleRecord}
            disabled={pending}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
          >
            {pending ? "Recording…" : "I made this trade — record it"}
          </button>
        </div>
      )}
    </div>
  );
}
