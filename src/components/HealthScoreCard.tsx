"use client";

import { useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";

interface SubScore {
  key: string;
  label: string;
  score: number;
  grade: string;
  sentence: string;
}

interface HealthScore {
  overall: number;
  overallGrade: string;
  subScores: SubScore[];
  computedAt: string;
}

interface HealthSnapshotRow {
  snapshotDate: string;
  overall: number;
}

function gradeColorClasses(grade: string): string {
  if (grade.startsWith("A")) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (grade.startsWith("B")) return "text-sky-700 bg-sky-50 border-sky-200";
  if (grade.startsWith("C")) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-red-700 bg-red-50 border-red-200";
}

export default function HealthScoreCard() {
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [history, setHistory] = useState<HealthSnapshotRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => {
        if (!res.ok) throw new Error("Couldn't load your health score.");
        return res.json();
      })
      .then((body) => {
        setHealth(body.health);
        setHistory(body.history ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold">Portfolio health score</h2>
      <p className="mt-1 text-xs text-slate-400">
        A daily gut-check, computed from your current holdings — not a
        prediction or advice.
      </p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {!error && !loaded && <p className="mt-3 text-sm text-slate-400">Loading…</p>}

      {health && (
        <div className="mt-4 grid gap-6 sm:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center justify-center gap-1">
            <div
              className={`flex h-24 w-24 flex-col items-center justify-center rounded-full border-4 text-2xl font-bold ${gradeColorClasses(health.overallGrade)}`}
            >
              {health.overallGrade}
              <span className="text-xs font-medium opacity-70">{Math.round(health.overall)}</span>
            </div>
            {history.length > 1 && (
              <div className="h-10 w-24">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <YAxis domain={[0, 100]} hide />
                    <Tooltip
                      formatter={(value) => [Math.round(Number(value)), "Score"]}
                      labelFormatter={(label) => label}
                    />
                    <Line
                      type="monotone"
                      dataKey="overall"
                      stroke="#0f172a"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <ul className="space-y-2">
            {health.subScores.map((s) => (
              <li key={s.key} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                <div className="flex items-center gap-2 sm:w-48 sm:shrink-0">
                  <span
                    className={`inline-flex w-10 justify-center rounded border px-1.5 py-0.5 text-xs font-semibold ${gradeColorClasses(s.grade)}`}
                  >
                    {s.grade}
                  </span>
                  <span className="text-sm font-medium text-slate-700">{s.label}</span>
                </div>
                <span className="text-sm text-slate-500">{s.sentence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
