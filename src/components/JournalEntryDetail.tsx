"use client";

import { horizonLabel, isPastHorizon, type JournalEntry } from "@/lib/journal";
import { formatShares, formatUsd } from "@/lib/format";
import { todayIso } from "@/lib/dates";

export default function JournalEntryDetail({
  entry,
  onDelete,
}: {
  entry: JournalEntry;
  onDelete: (id: number) => void;
}) {
  const pastHorizon = isPastHorizon(entry, todayIso());

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-500">
        Bought {entry.shares != null ? formatShares(entry.shares) : "—"} shares
        {entry.costPerShare != null ? ` at ${formatUsd(entry.costPerShare)}` : ""} on{" "}
        {entry.purchaseDate}
        {entry.lotId == null && " — this lot has since been fully sold."}
      </p>

      <div>
        <p className="font-medium text-slate-700">Why I bought it</p>
        <p className="text-slate-600">{entry.reason}</p>
      </div>

      <div>
        <p className="font-medium text-slate-700">Time horizon</p>
        <p className="text-slate-600">
          {horizonLabel(entry.timeHorizon)}
          {entry.horizonReviewDate && (
            <span className={pastHorizon ? "ml-1.5 font-medium text-amber-700" : "ml-1.5 text-slate-400"}>
              {pastHorizon
                ? `— that window closed on ${entry.horizonReviewDate}.`
                : `(review around ${entry.horizonReviewDate})`}
            </span>
          )}
        </p>
      </div>

      {entry.sellTrigger && (
        <div>
          <p className="font-medium text-slate-700">What would make me sell</p>
          <p className="text-slate-600">{entry.sellTrigger}</p>
        </div>
      )}

      {entry.risks && (
        <div>
          <p className="font-medium text-slate-700">Risks I was watching</p>
          <p className="text-slate-600">{entry.risks}</p>
        </div>
      )}

      {entry.aiReview && (
        <details className="rounded border border-slate-200 bg-white p-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-500">
            The AI&apos;s take at the time
          </summary>
          <p className="mt-2 whitespace-pre-line text-slate-600">{entry.aiReview}</p>
        </details>
      )}

      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-slate-400">
          Noted {new Date(entry.createdAt).toLocaleDateString()}
        </p>
        <button
          onClick={() => onDelete(entry.id)}
          className="text-xs text-red-500 hover:text-red-700"
        >
          Delete note
        </button>
      </div>
    </div>
  );
}
