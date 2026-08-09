"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Account } from "@/lib/types";
import type { SimulationResult, Severity } from "@/lib/simulate";
import { resolveAccountId } from "@/lib/accounts";
import { formatUsd } from "@/lib/format";
import TickerHint from "@/components/TickerHint";
import OverlapPanel from "@/components/OverlapPanel";
import TaxCheckPanel from "@/components/TaxCheckPanel";
import ScoreDeltaPanel from "@/components/ScoreDeltaPanel";
import TradeReviewPanel from "@/components/TradeReviewPanel";
import JournalPrompt, { type JournalPromptTarget } from "@/components/JournalPrompt";
import { DEMO_SUGGESTED_TRADE } from "@/lib/demoPortfolio";

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

interface TradeSimulatorProps {
  accounts: Account[];
  /** Renders against the public, unauthenticated `/api/demo/simulate` route
   *  and hides every feature that requires a signed-in session (AI second
   *  opinion, trade recording, journal prompt) — see `src/app/demo/page.tsx`. */
  demo?: boolean;
}

export default function TradeSimulator({ accounts, demo = false }: TradeSimulatorProps) {
  const router = useRouter();
  const [side, setSide] = useState<"buy" | "sell">(demo ? DEMO_SUGGESTED_TRADE.side : "buy");
  const [ticker, setTicker] = useState(demo ? DEMO_SUGGESTED_TRADE.ticker : "");
  const [shares, setShares] = useState(demo ? String(DEMO_SUGGESTED_TRADE.shares) : "");
  const [pricePerShare, setPricePerShare] = useState(
    demo ? String(DEMO_SUGGESTED_TRADE.pricePerShare) : ""
  );
  const [accountId, setAccountId] = useState(
    demo ? DEMO_SUGGESTED_TRADE.accountId : (accounts[0]?.id ?? 0)
  );
  // Same soft-refresh staleness `resolveAccountId` guards against on
  // `/holdings` — a live account created just before this page loads
  // shouldn't leave the picker pointing at a stale/nonexistent id.
  const selectedAccountId = resolveAccountId(accounts, accountId);
  const [rationale, setRationale] = useState("");
  const [reviewText, setReviewText] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [journalTarget, setJournalTarget] = useState<JournalPromptTarget | null>(null);

  const tradePayload = {
    side,
    ticker,
    shares: Number(shares),
    pricePerShare: Number(pricePerShare),
    accountId: selectedAccountId,
  };

  async function handleSimulate(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setRecorded(false);
    setReviewText(null);
    const res = await fetch(demo ? "/api/demo/simulate" : "/api/simulate", {
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
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.error ?? "Something went wrong.");
      return;
    }
    setRecorded(true);
    // Sells return no lotId — nothing to journal. Snapshot the trade's own
    // values now: `setResult(null)` below unmounts the result panel, so
    // the journal prompt (rendered outside it) needs its own copy.
    if (body?.lotId) {
      setJournalTarget({
        lotId: body.lotId,
        ticker: ticker.toUpperCase(),
        shares: Number(shares),
        costPerShare: Number(pricePerShare),
        purchaseDate: new Date().toISOString().slice(0, 10),
      });
    }
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
        </div>
        <div className="mt-2">
          <TickerHint ticker={ticker} />
        </div>
        {!demo && (
          <label className="mt-3 flex flex-col gap-1 text-sm">
            <span className="text-slate-600">
              Why are you making this trade? (optional — used only for the AI second opinion below)
            </span>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={2}
              placeholder="e.g. Long-term growth conviction, diversifying out of tech, rebalancing…"
              className="rounded border border-slate-300 px-2 py-1.5"
            />
          </label>
        )}
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

          {result.washSale && (() => {
            // An empty trigger list means the only evidence was an
            // uncheckable lot/sale (no known date/basis) — nothing has
            // actually been confirmed as a wash sale (see washSale.ts's
            // uncheckable branches, which all hardcode isIraPermanent:
            // false for the same reason). That gets its own amber "can't
            // verify" treatment instead of the red "confirmed" panel, so
            // the heading and footer never assert an outcome the message
            // right below them says isn't confirmed.
            const unconfirmed = result.washSale.triggers.length === 0;
            return (
              <div
                className={
                  unconfirmed
                    ? "rounded-lg border border-amber-200 bg-amber-50 p-5"
                    : result.washSale.isIraPermanent
                      ? "rounded-lg border-2 border-red-400 bg-red-100 p-5"
                      : "rounded-lg border border-red-200 bg-red-50 p-5"
                }
              >
                <h3 className={unconfirmed ? "font-semibold text-amber-800" : "font-semibold text-red-800"}>
                  {unconfirmed
                    ? "Can't fully check this for a wash sale"
                    : result.washSale.isIraPermanent
                      ? "⚠️ Wash sale — loss permanently disallowed (IRA)"
                      : "Wash-sale warning"}
                </h3>
                {!unconfirmed && (
                  <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
                    {result.washSale.triggers.map((t) => (
                      <li key={`${t.date}-${t.accountName}`}>
                        {t.date}: {t.description}
                        {t.isIra && (
                          <span className="ml-1.5 rounded bg-red-200 px-1.5 py-0.5 text-xs font-medium text-red-800">
                            IRA
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className={unconfirmed ? "mt-2 text-sm text-amber-700" : "mt-2 text-sm text-red-700"}>
                  {result.washSale.message}
                </p>
                {!unconfirmed && result.washSale.uncheckableLots.length > 0 && (
                  <p className="mt-2 text-sm text-amber-700">
                    Additionally, {result.washSale.uncheckableLots.reduce((sum, l) => sum + l.shares, 0)}{" "}
                    {result.washSale.uncheckableLots[0].ticker} shares (synced with no known purchase
                    date) couldn&apos;t be checked against the 30-day window.
                  </p>
                )}
                {!unconfirmed && result.washSale.uncheckableSales.length > 0 && (
                  <p className="mt-2 text-sm text-amber-700">
                    Additionally, a sale of {result.washSale.uncheckableSales.reduce((sum, s) => sum + s.shares, 0)}{" "}
                    {result.washSale.uncheckableSales[0].ticker} shares (synced with no known cost
                    basis) couldn&apos;t be confirmed as a loss.
                  </p>
                )}
                {!unconfirmed &&
                  (result.washSale.isIraPermanent ? (
                    <p className="mt-2 text-xs text-red-600">
                      This is worse than a same-taxable-account wash sale: because
                      the replacement shares sit in an IRA, the loss can never be
                      recovered by adding it to a future cost basis — it&apos;s
                      gone for good (Rev. Rul. 2008-5). This check is binary — any
                      ticker match flags, regardless of share counts.
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-red-600">
                      This check is binary — any ticker match flags, regardless of
                      share counts. The IRS disallows the loss proportionally to
                      replacement shares.
                    </p>
                  ))}
              </div>
            );
          })()}

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

          <ScoreDeltaPanel diversification={result.scores.diversification} risk={result.scores.risk} />

          <OverlapPanel overlap={result.etfOverlap} />

          {result.taxCheck && <TaxCheckPanel taxCheck={result.taxCheck} />}

          {!demo && (
            <TradeReviewPanel
              tradePayload={tradePayload}
              rationale={rationale}
              onReview={setReviewText}
            />
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

          {demo ? (
            <Link
              href="/login"
              className="inline-block rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Run this on your real portfolio →
            </Link>
          ) : (
            <button
              onClick={handleRecord}
              disabled={pending}
              className="rounded border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
            >
              {pending ? "Recording…" : "I made this trade — record it"}
            </button>
          )}
        </div>
      )}

      {!demo && journalTarget && (
        <JournalPrompt
          target={journalTarget}
          defaultReason={rationale}
          aiReview={reviewText}
          source="simulator"
          onDone={() => setJournalTarget(null)}
        />
      )}
    </div>
  );
}
