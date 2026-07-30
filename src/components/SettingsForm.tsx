"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SettingsForm({
  initialThreshold,
}: {
  initialThreshold: number;
}) {
  const router = useRouter();
  const [threshold, setThreshold] = useState(String(initialThreshold));
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
      body: JSON.stringify({ concentrationThreshold: Number(threshold) }),
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
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-600">
          Flag a sector as &ldquo;elevated&rdquo; above (%)
        </span>
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
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {saved && <p className="text-sm text-emerald-600">Saved.</p>}
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
