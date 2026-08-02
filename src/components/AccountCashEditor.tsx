"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Account } from "@/lib/types";
import { ACCOUNT_TYPE_LABELS } from "@/lib/types";

function AccountChip({ account }: { account: Account }) {
  const router = useRouter();
  const [value, setValue] = useState(String(account.cashBalance));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const cashBalance = Number(value);
    if (!Number.isFinite(cashBalance) || cashBalance < 0) {
      setError("Cash must be a non-negative number.");
      return;
    }
    if (cashBalance === account.cashBalance) return;
    setPending(true);
    setError(null);
    const res = await fetch(`/api/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cashBalance }),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Couldn't save.");
      return;
    }
    router.refresh();
  }

  return (
    <li className="flex flex-col gap-1 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
      <div>
        {account.name}
        <span className="ml-1.5 text-xs text-slate-400">{ACCOUNT_TYPE_LABELS[account.type]}</span>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        Cash: $
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          type="number"
          step="any"
          min="0"
          disabled={pending}
          className="w-20 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-700"
        />
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </li>
  );
}

export default function AccountCashEditor({ accounts }: { accounts: Account[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {accounts.map((a) => (
        <AccountChip key={a.id} account={a} />
      ))}
    </ul>
  );
}
