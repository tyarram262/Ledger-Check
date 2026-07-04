"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountType } from "@/lib/types";
import { ACCOUNT_TYPE_LABELS } from "@/lib/types";

export default function AccountForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("taxable");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type }),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Something went wrong.");
      return;
    }
    setName("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-600">Account name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Vanguard Roth"
          required
          className="rounded border border-slate-300 px-2 py-1.5"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-600">Type</span>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AccountType)}
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
        >
          {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add account"}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
