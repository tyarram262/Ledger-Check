"use client";

import { useState } from "react";

interface TradePayload {
  side: "buy" | "sell";
  ticker: string;
  shares: number;
  pricePerShare: number;
  accountId?: number;
}

interface TradeReview {
  content: string;
  createdAt: string;
}

export default function TradeReviewPanel({
  tradePayload,
  rationale,
  onReview,
}: {
  tradePayload: TradePayload;
  rationale: string;
  onReview?: (content: string) => void;
}) {
  const [review, setReview] = useState<TradeReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleGetReview() {
    setPending(true);
    setError(null);
    const res = await fetch("/api/trade-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...tradePayload, rationale }),
    });
    setPending(false);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.error ?? "Something went wrong.");
      return;
    }
    setReview(body.review);
    onReview?.(body.review.content);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">AI second opinion</h3>
        <button
          onClick={handleGetReview}
          disabled={pending}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
        >
          {pending ? "Thinking…" : review ? "Ask again" : "Get a second opinion"}
        </button>
      </div>

      {review ? (
        <>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">
            {review.content}
          </p>
          <p className="mt-2 text-xs text-slate-400">
            Generated {new Date(review.createdAt).toLocaleString()} — a devil&apos;s-advocate
            take on the facts above, not advice.
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          Get an AI critique that challenges your reasoning for this trade — never a buy/sell
          recommendation. Generated on demand; nothing is sent anywhere until you click the
          button.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
