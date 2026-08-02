"use client";

import type { SubScore } from "@/lib/scores";

interface ScoreDelta {
  before: SubScore;
  after: SubScore;
}

export default function ScoreDeltaPanel({
  diversification,
  risk,
}: {
  diversification: ScoreDelta;
  risk: ScoreDelta;
}) {
  const rows: { label: string; delta: ScoreDelta }[] = [
    { label: "Diversification", delta: diversification },
    { label: "Risk", delta: risk },
  ];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="text-base font-semibold">Score impact</h3>
      <ul className="mt-3 space-y-2">
        {rows.map(({ label, delta }) => {
          const change = delta.after.score - delta.before.score;
          return (
            <li key={label} className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700">{label}</span>
              <span className="text-slate-500">
                {delta.before.grade} ({Math.round(delta.before.score)}) → {delta.after.grade} (
                {Math.round(delta.after.score)})
                {Math.abs(change) >= 1 && (
                  <span
                    className={`ml-1.5 font-medium ${change > 0 ? "text-emerald-600" : "text-red-600"}`}
                  >
                    ({change > 0 ? "+" : ""}
                    {Math.round(change)})
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
