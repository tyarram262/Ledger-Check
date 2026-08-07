"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AccountType } from "@/lib/types";
import { ACCOUNT_TYPE_LABELS } from "@/lib/types";
// Type-only import — erased at compile time, so this doesn't pull
// sync.ts's server-only code (Supabase queries, `next/headers`) into the
// client bundle. Reuses the single source of truth instead of redeclaring
// the same shapes here with drift risk.
import type { ConnectionStatus, DiscoveredAccount, SyncSummary } from "@/lib/brokerage/sync";

const ACCOUNT_TYPES: AccountType[] = ["taxable", "roth", "traditional_ira"];

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Shared fetch→JSON→error-shape handling for this component's four
 *  brokerage endpoints, replacing four near-identical inline blocks. */
async function callApi<T>(url: string, fallback: string, options?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(url, options).catch(() => null);
  if (!res) return { ok: false, error: fallback };
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: body?.error ?? fallback };
  return { ok: true, data: body as T };
}

/**
 * Brokerage sync entry point on `/holdings`, alongside manual entry and
 * CSV import — not a separate page, per the app's "avoid unnecessary
 * dashboards" design philosophy. Renders nothing when SnapTrade isn't
 * configured (`SNAPTRADE_CLIENT_ID`/`SNAPTRADE_CONSUMER_KEY` unset), so
 * nothing regresses before those keys exist — see CLAUDE.md.
 *
 * Uses a full-page redirect to SnapTrade's Connection Portal rather than
 * the iframe + postMessage flow, to avoid a React SDK dependency and a
 * modal lifecycle for this first slice.
 */
export default function BrokerageConnect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredAccount[] | null>(null);
  const [types, setTypes] = useState<Record<string, AccountType>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncSummaries, setSyncSummaries] = useState<SyncSummary[] | null>(null);

  useEffect(() => {
    fetch("/api/brokerage/status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (searchParams.get("connected") === "1") {
      loadAccounts();
    }
  }, [searchParams]);

  async function loadAccounts() {
    setPending("loading");
    setError(null);
    const result = await callApi<DiscoveredAccount[]>(
      "/api/brokerage/accounts",
      "Failed to load brokerage accounts."
    );
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDiscovered(result.data);
    setTypes(Object.fromEntries(result.data.map((a) => [a.externalId, a.inferredType ?? "taxable"])));
  }

  async function handleConnect() {
    setPending("connect");
    setError(null);
    const result = await callApi<{ url: string }>(
      "/api/brokerage/connect",
      "Failed to start the brokerage connection.",
      { method: "POST" }
    );
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.location.href = result.data.url;
  }

  async function handleLink(account: DiscoveredAccount) {
    setPending(account.externalId);
    setError(null);
    const linkResult = await callApi<{ accountId: number }>("/api/brokerage/link", "Failed to link that account.", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        externalAccountId: account.externalId,
        name: account.name,
        type: types[account.externalId] ?? "taxable",
      }),
    });
    if (!linkResult.ok) {
      setPending(null);
      setError(linkResult.error);
      return;
    }
    const syncResult = await callApi<{ summaries: SyncSummary[] }>("/api/brokerage/sync", "Sync failed.", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: linkResult.data.accountId }),
    });
    setPending(null);
    if (syncResult.ok) {
      setSyncSummaries((prev) => [...(prev ?? []), ...syncResult.data.summaries]);
    }
    setDiscovered((prev) =>
      (prev ?? []).map((a) => (a.externalId === account.externalId ? { ...a, alreadyLinked: true } : a))
    );
    router.refresh();
  }

  async function handleSyncAll() {
    setPending("sync-all");
    setError(null);
    const result = await callApi<{ summaries: SyncSummary[] }>("/api/brokerage/sync", "Sync failed.", {
      method: "POST",
    });
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSyncSummaries(result.data.summaries);
    router.refresh();
  }

  /** Disconnects a brokerage connection — its accounts/lots stay in
   *  `/holdings` as a frozen snapshot (see `sync.ts`'s
   *  `disconnectConnection` doc comment), only the connection itself and
   *  its "keep syncing" status go away. */
  async function handleDisconnect(connectionId: number) {
    setPending(`disconnect-${connectionId}`);
    setError(null);
    const result = await callApi<{ ok: true }>(`/api/brokerage/connections/${connectionId}`, "Failed to disconnect.", {
      method: "DELETE",
    });
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStatus((prev) =>
      prev ? { ...prev, connections: prev.connections.filter((c) => c.id !== connectionId) } : prev
    );
    router.refresh();
  }

  if (!status || !status.configured) return null;

  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">…or sync a brokerage</h3>

      {!discovered && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleConnect}
            disabled={pending === "connect"}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
          >
            {pending === "connect" ? "Connecting…" : "Connect a brokerage"}
          </button>
          {status.connected && (
            <button
              onClick={loadAccounts}
              disabled={pending === "loading"}
              className="text-sm text-slate-500 underline hover:text-slate-700"
            >
              {pending === "loading" ? "Loading…" : "View connected accounts"}
            </button>
          )}
          {status.connections.length > 0 && (
            <button
              onClick={handleSyncAll}
              disabled={pending === "sync-all"}
              className="text-sm text-slate-500 underline hover:text-slate-700"
            >
              {pending === "sync-all" ? "Syncing…" : "Sync all connected accounts"}
            </button>
          )}
        </div>
      )}

      {!discovered && status.connections.length > 0 && (
        <ul className="mt-3 space-y-2">
          {status.connections.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded border border-slate-200 p-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.brokerageName ?? "Brokerage connection"}</p>
                <p className="text-xs text-slate-500">
                  {c.lastSyncedAt
                    ? `Last synced ${new Date(c.lastSyncedAt).toLocaleString()}`
                    : "Not synced yet"}
                  {c.disabled && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">
                      Needs attention at the brokerage
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => handleDisconnect(c.id)}
                disabled={pending === `disconnect-${c.id}`}
                className="rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {pending === `disconnect-${c.id}` ? "Disconnecting…" : "Disconnect"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {discovered && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Confirm each account&apos;s type before linking — this determines how wash-sale and
            tax rules apply, so double-check anything guessed wrong.
          </p>
          <ul className="space-y-2">
            {discovered.map((a) => (
              <li
                key={a.externalId}
                className="flex flex-wrap items-center gap-3 rounded border border-slate-200 p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs text-slate-500">
                    {a.institutionName}
                    {a.rawType ? ` · reported as "${a.rawType}"` : ""}
                  </p>
                </div>
                {a.alreadyLinked ? (
                  <span className="text-xs text-emerald-600">Linked</span>
                ) : (
                  <>
                    <select
                      value={types[a.externalId] ?? "taxable"}
                      onChange={(e) =>
                        setTypes((prev) => ({ ...prev, [a.externalId]: e.target.value as AccountType }))
                      }
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    >
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {ACCOUNT_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleLink(a)}
                      disabled={pending === a.externalId}
                      className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      {pending === a.externalId ? "Linking…" : "Link"}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {syncSummaries && syncSummaries.length > 0 && (
        <div className="mt-3 space-y-1 text-sm">
          {syncSummaries.map((s) => (
            <p key={s.accountId} className="text-slate-600">
              Account #{s.accountId}: {s.lotsSynced} lot{s.lotsSynced === 1 ? "" : "s"} synced
              {s.lotsRemoved > 0 ? `, ${s.lotsRemoved} removed` : ""}
              {s.salesImported > 0 ? `, ${s.salesImported} sale${s.salesImported === 1 ? "" : "s"} imported` : ""}.
              {s.warnings.length > 0 && (
                <span className="block text-amber-700">{s.warnings.join(" ")}</span>
              )}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
