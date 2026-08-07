import { snapTradeProvider, isSnapTradeConfigured, isAuthRevokedError } from "@/lib/brokerage/snaptrade";
import type { BrokerageAccount } from "@/lib/brokerage/types";
import {
  getCurrentUserId,
  getSnapTradeCredentials,
  saveSnapTradeCredentials,
  upsertBrokerageConnection,
  upsertSnapTradeAccount,
  listSnapTradeAccountLinks,
  upsertSyncedLots,
  upsertSyncedSales,
  updateAccountCash,
  touchConnectionSynced,
  setConnectionDisabled,
  listBrokerageConnections,
  detachAccountsFromConnection,
  deleteBrokerageConnection,
  type SnapTradeCredentials,
  type BrokerageConnectionRow,
} from "@/lib/queries";
import type { AccountType } from "@/lib/types";

/**
 * Orchestration layer between the `/api/brokerage/*` routes and the
 * provider-neutral `BrokerageProvider` + `queries.ts`. Keeps the routes
 * thin (validate → delegate → respond), matching the rest of the app's
 * API-route pattern (see `api/import/route.ts`).
 */

export { isSnapTradeConfigured };

async function credentials(): Promise<{ externalUserId: string; userSecret: string }> {
  const creds = await getSnapTradeCredentials();
  if (!creds) {
    throw new Error("Connect a brokerage account first.");
  }
  return { externalUserId: creds.snaptradeUserId, userSecret: creds.userSecret };
}

async function getOrRegisterCredentials(): Promise<SnapTradeCredentials> {
  const existing = await getSnapTradeCredentials();
  if (existing) return existing;
  const appUserId = await getCurrentUserId();
  const { externalUserId, userSecret } = await snapTradeProvider.registerUser(appUserId);
  const creds: SnapTradeCredentials = { snaptradeUserId: externalUserId, userSecret };
  await saveSnapTradeCredentials(creds);
  return creds;
}

export async function startConnection(redirectUri: string): Promise<string> {
  const creds = await getOrRegisterCredentials();
  return snapTradeProvider.connectionPortalUrl(
    { externalUserId: creds.snaptradeUserId, userSecret: creds.userSecret },
    redirectUri
  );
}

export interface DiscoveredAccount extends BrokerageAccount {
  alreadyLinked: boolean;
}

/** Lists the SnapTrade accounts available to link. Read-only — creating
 *  the `brokerage_connections` row is `linkAccount`'s job (the actual
 *  write-time operation), not this GET-backing function's; an earlier
 *  version upserted connections here too, which was redundant with
 *  `linkAccount` doing the same upsert and gave a read a side effect for
 *  no benefit. */
export async function discoverAccounts(): Promise<DiscoveredAccount[]> {
  const creds = await getSnapTradeCredentials();
  if (!creds) return [];
  const accounts = await snapTradeProvider.listAccounts({
    externalUserId: creds.snaptradeUserId,
    userSecret: creds.userSecret,
  });

  const links = await listSnapTradeAccountLinks();
  const linkedExternalIds = new Set(links.map((l) => l.snaptradeAccountId));
  return accounts.map((a) => ({ ...a, alreadyLinked: linkedExternalIds.has(a.externalId) }));
}

/** Links (or re-links, idempotently) one SnapTrade account as a local
 *  `accounts` row. Re-fetches the account from SnapTrade rather than
 *  trusting the request body's `externalAccountId` blindly — this
 *  confirms the account genuinely belongs to this SnapTrade user before
 *  writing anything. */
export async function linkAccount(input: {
  externalAccountId: string;
  name: string;
  type: AccountType;
}): Promise<number> {
  const creds = await credentials();
  const accounts = await snapTradeProvider.listAccounts(creds);
  const match = accounts.find((a) => a.externalId === input.externalAccountId);
  if (!match) {
    throw new Error("That account wasn't found in your SnapTrade connection.");
  }
  const connectionId = await upsertBrokerageConnection({
    authorizationId: match.authorizationId,
    brokerageName: match.institutionName,
  });
  const account = await upsertSnapTradeAccount({
    name: input.name,
    type: input.type,
    snaptradeAccountId: match.externalId,
    connectionId,
  });
  return account.id;
}

export interface SyncSummary {
  accountId: number;
  lotsSynced: number;
  lotsRemoved: number;
  salesImported: number;
  cashUpdated: boolean;
  warnings: string[];
}

/**
 * Syncs one account's holdings, cash, and realized-sale history.
 *
 * On a fetch failure whose status indicates the brokerage authorization
 * itself was revoked or disabled (`isAuthRevokedError` — 401/403, not a
 * transient 429/5xx/network blip), flags the connection via
 * `setConnectionDisabled` before rethrowing, so the "needs attention at the
 * brokerage" badge (`BrokerageConnect.tsx`) shows up without the user
 * having to notice a silently-stale sync themselves. `syncAccounts`'
 * `allSettled` turns the rethrow into a per-account warning either way; this
 * only adds the persistent flag on top for the specific case that's
 * actually actionable (reconnect at the brokerage) rather than just "try
 * again later".
 */
async function syncOneAccount(
  creds: { externalUserId: string; userSecret: string },
  link: { accountId: number; snaptradeAccountId: string; connectionId: number | null }
): Promise<SyncSummary> {
  let holdings: Awaited<ReturnType<typeof snapTradeProvider.fetchHoldings>>;
  try {
    holdings = await snapTradeProvider.fetchHoldings(creds, link.snaptradeAccountId);
  } catch (err) {
    if (link.connectionId != null && isAuthRevokedError(err)) {
      await setConnectionDisabled(link.connectionId, true);
    }
    throw err;
  }
  const { lots, sales, cash, warnings } = holdings;

  const { upserted, removed } = await upsertSyncedLots(link.accountId, lots);
  const { upserted: salesImported } = await upsertSyncedSales(link.accountId, sales);

  let cashUpdated = false;
  if (cash != null) {
    await updateAccountCash(link.accountId, cash);
    cashUpdated = true;
  }
  if (link.connectionId != null) {
    // Also clears `disabled` — a successful sync is itself proof the
    // connection has recovered from whatever set it (see
    // `touchConnectionSynced`'s doc comment).
    await touchConnectionSynced(link.connectionId);
  }
  return {
    accountId: link.accountId,
    lotsSynced: upserted,
    lotsRemoved: removed,
    salesImported,
    cashUpdated,
    warnings,
  };
}

/** Syncs one linked account (`onlyAccountId`) or every linked account.
 *  Accounts are independent — synced in parallel via `allSettled` so one
 *  account's failure (e.g. a stale SnapTrade connection) doesn't block the
 *  rest; a failed account's warning is folded into its own summary rather
 *  than aborting the whole request. */
export async function syncAccounts(onlyAccountId?: number): Promise<SyncSummary[]> {
  const creds = await credentials();
  const links = (await listSnapTradeAccountLinks()).filter(
    (l) => onlyAccountId === undefined || l.accountId === onlyAccountId
  );
  if (onlyAccountId !== undefined && links.length === 0) {
    throw new Error("That account isn't linked to a brokerage connection.");
  }

  const results = await Promise.allSettled(links.map((link) => syncOneAccount(creds, link)));
  return results.map((result, i) =>
    result.status === "fulfilled"
      ? result.value
      : {
          accountId: links[i].accountId,
          lotsSynced: 0,
          lotsRemoved: 0,
          salesImported: 0,
          cashUpdated: false,
          warnings: [result.reason instanceof Error ? result.reason.message : "Sync failed for this account."],
        }
  );
}

/**
 * Disconnects one brokerage connection: best-effort removes the
 * authorization at SnapTrade, then detaches every account it synced
 * (see `detachAccountsFromConnection`'s doc comment — accounts/lots are
 * kept as a frozen snapshot, not deleted) before deleting the local
 * `brokerage_connections` row. Order matters: accounts must be detached
 * (their `connection_id` cleared) before the connection row is deleted,
 * even though the FK is `on delete set null` and would eventually get
 * there anyway — doing it explicitly first also lets us set `sync_source`
 * back to `'manual'` in the same step, which the FK cascade alone
 * wouldn't do.
 */
export async function disconnectConnection(connectionId: number): Promise<void> {
  const connections = await listBrokerageConnections();
  const connection = connections.find((c) => c.id === connectionId);
  if (!connection) {
    throw new Error("That brokerage connection wasn't found.");
  }

  const creds = await getSnapTradeCredentials();
  if (creds) {
    try {
      await snapTradeProvider.disconnectAuthorization(
        { externalUserId: creds.snaptradeUserId, userSecret: creds.userSecret },
        connection.authorizationId
      );
    } catch {
      // Best-effort — see `BrokerageProvider.disconnectAuthorization`'s doc
      // comment. Local cleanup below must proceed either way: a user
      // clicking "Disconnect" expects it gone from their view regardless
      // of whether SnapTrade's side succeeds.
    }
  }

  await detachAccountsFromConnection(connectionId);
  await deleteBrokerageConnection(connectionId);
}

export interface ConnectionStatus {
  configured: boolean;
  connected: boolean;
  connections: BrokerageConnectionRow[];
}

export async function connectionStatus(): Promise<ConnectionStatus> {
  if (!isSnapTradeConfigured()) {
    return { configured: false, connected: false, connections: [] };
  }
  const [creds, connections] = await Promise.all([getSnapTradeCredentials(), listBrokerageConnections()]);
  return { configured: true, connected: creds !== null, connections };
}
