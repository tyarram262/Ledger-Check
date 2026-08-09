"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Account } from "@/lib/types";
import { resolveAccountId } from "@/lib/accounts";

interface ImportSummary {
  imported: number;
  rowErrors: { line: number; message: string }[];
}

export default function CsvImport({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? 0);
  const selectedAccountId = resolveAccountId(accounts, accountId);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setPending(true);
    setError(null);
    setSummary(null);
    const csv = await file.text();
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: selectedAccountId, csv }),
    });
    const body = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) {
      setError(body?.error ?? "Something went wrong.");
      if (body?.rowErrors?.length) {
        setSummary({ imported: 0, rowErrors: body.rowErrors });
      }
      return;
    }
    setSummary(body);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm text-slate-500">
        Upload a brokerage positions export. Needs columns for symbol,
        quantity, cost (per-share or total basis), and purchase date — most
        broker CSVs work as-is. Each row becomes one lot in the account you
        pick.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Into account</span>
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
          <span className="text-slate-600">CSV file</span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            required
            className="rounded border border-slate-300 px-2 py-1.5 text-sm file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-0.5"
          />
        </label>
        <button
          type="submit"
          disabled={pending || accounts.length === 0}
          className="rounded border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
        >
          {pending ? "Importing…" : "Import"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {summary && (
        <div className="text-sm">
          {summary.imported > 0 && (
            <p className="text-emerald-600">
              Imported {summary.imported} lot
              {summary.imported === 1 ? "" : "s"}.
            </p>
          )}
          {summary.rowErrors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-amber-700">
              {summary.rowErrors.slice(0, 8).map((e) => (
                <li key={e.line}>
                  Line {e.line}: {e.message}
                </li>
              ))}
              {summary.rowErrors.length > 8 && (
                <li>…and {summary.rowErrors.length - 8} more.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
