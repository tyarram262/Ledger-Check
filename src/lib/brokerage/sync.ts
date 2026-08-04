import { snapTradeProvider, isSnapTradeConfigured } from "@/lib/brokerage/snaptrade";
import type { BrokerageAccount } from "@/lib/brokerage/types";
import {
  getCurrentUserId,
  getSnapTradeCredentials,
  saveSnapTradeCredentials,
  upsertBrokerageConnection,
  upsertSnapTradeAccount,
  listSnapTradeAccountLinks,
  upsertSyncedLots,
  updateAccountCash,
  touchConnectionSynced,
  listBrokerageConnections,
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
  cashUpdated: boolean;
  warnings: string[];
}

async function syncOneAccount(
  creds: { externalUserId: string; userSecret: string },
  link: { accountId: number; snaptradeAccountId: string; connectionId: number | null }
): Promise<SyncSummary> {
  const { lots, cash, warnings } = await snapTradeProvider.fetchHoldings(creds, link.snaptradeAccountId);
  const { upserted, removed } = await upsertSyncedLots(link.accountId, lots);

  let cashUpdated = false;
  if (cash != null) {
    await updateAccountCash(link.accountId, cash);
    cashUpdated = true;
  }
  if (link.connectionId != null) {
    await touchConnectionSynced(link.connectionId);
  }
  return { accountId: link.accountId, lotsSynced: upserted, lotsRemoved: removed, cashUpdated, warnings };
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
          cashUpdated: false,
          warnings: [result.reason instanceof Error ? result.reason.message : "Sync failed for this account."],
        }
  );
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
