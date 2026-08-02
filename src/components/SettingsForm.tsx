"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FilingStatus } from "@/lib/taxRates";

const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: "Single",
  married_joint: "Married filing jointly",
  married_separate: "Married filing separately",
  head_of_household: "Head of household",
};

interface SettingsFormValues {
  concentrationThreshold: number;
  filingStatus: FilingStatus;
  annualTaxableIncome: number;
  stateTaxRate: number;
}

export default function SettingsForm({
  initialSettings,
}: {
  initialSettings: SettingsFormValues;
}) {
  const router = useRouter();
  const [threshold, setThreshold] = useState(String(initialSettings.concentrationThreshold));
  const [filingStatus, setFilingStatus] = useState<FilingStatus>(initialSettings.filingStatus);
  const [income, setIncome] = useState(String(initialSettings.annualTaxableIncome));
  const [stateRate, setStateRate] = useState(String(initialSettings.stateTaxRate));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        concentrationThreshold: Number(threshold),
        filingStatus,
        annualTaxableIncome: Number(income),
        stateTaxRate: Number(stateRate),
      }),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Something went wrong.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-700">Sector concentration</h3>
        <label className="mt-2 flex flex-col gap-1 text-sm sm:w-64">
          <span className="text-slate-600">Flag a sector as &ldquo;elevated&rdquo; above (%)</span>
          <input
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            type="number"
            step="any"
            min="1"
            max="100"
            required
            className="w-28 rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-700">Tax profile</h3>
        <p className="mt-1 text-xs text-slate-500">
          Used only to estimate marginal tax rates on the trade check &mdash;
          not stored or sent anywhere beyond this app, and never treated as
          tax advice.
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Filing status</span>
            <select
              value={filingStatus}
              onChange={(e) => setFilingStatus(e.target.value as FilingStatus)}
              className="rounded border border-slate-300 bg-white px-2 py-1.5"
            >
              {Object.entries(FILING_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Est. annual taxable income ($)</span>
            <input
              value={income}
              onChange={(e) => setIncome(e.target.value)}
              type="number"
              step="any"
              min="0"
              required
              className="rounded border border-slate-300 px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Flat state tax rate (%)</span>
            <input
              value={stateRate}
              onChange={(e) => setStateRate(e.target.value)}
              type="number"
              step="any"
              min="0"
              max="100"
              required
              className="rounded border border-slate-300 px-2 py-1.5"
            />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && <p className="text-sm text-emerald-600">Saved.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </form>
  );
}
