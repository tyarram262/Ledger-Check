"use client";

import { useEffect, useState } from "react";

interface Digest {
  content: string;
  createdAt: string;
  stale: boolean;
}

export default function DigestCard() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/digest")
      .then((res) => res.json())
      .then((body) => setDigest(body.digest))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function handleGenerate() {
    setPending(true);
    setError(null);
    const res = await fetch("/api/digest", { method: "POST" });
    const body = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) {
      setError(body?.error ?? "Something went wrong.");
      return;
    }
    setDigest(body.digest);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">AI risk digest</h2>
        <button
          onClick={handleGenerate}
          disabled={pending || !loaded}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
        >
          {pending ? "Thinking…" : digest ? "Regenerate" : "Generate"}
        </button>
      </div>

      {digest ? (
        <>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            {digest.content}
          </p>
          <p className="mt-2 text-xs text-slate-400">
            Generated {new Date(digest.createdAt).toLocaleString()}
            {digest.stale && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">
                Holdings changed since — regenerate for a fresh take
              </span>
            )}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          A short plain-English summary of your portfolio&apos;s biggest risk,
          written by AI. Generated on demand — nothing is sent anywhere until
          you click the button.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
