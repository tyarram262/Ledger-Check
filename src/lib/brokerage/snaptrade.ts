import { Snaptrade, SnaptradeAuth, type CommercialApiKeyAuth } from "snaptrade-typescript-sdk";
import { inferAccountType, type BrokerageAccount, type BrokerageProvider, type FetchHoldingsResult } from "@/lib/brokerage/types";
import { reconcileLots, type ActivityInput, type RawTaxLot } from "@/lib/brokerage/reconcileLots";

/**
 * SnapTrade adapter — the only file in the app that knows SnapTrade's
 * actual request/response shapes. Everything else depends on the
 * provider-neutral types in `types.ts`.
 *
 * **Server-side only.** `userSecret` grants read access to the user's live
 * brokerage data; it must never reach a client component or be logged
 * (see `queries.ts`'s `getSnapTradeCredentials` doc comment).
 */

function isConfigured(): boolean {
  return Boolean(process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY);
}

let client: Snaptrade<CommercialApiKeyAuth> | null = null;

function getClient(): Snaptrade<CommercialApiKeyAuth> {
  if (!isConfigured()) {
    throw new Error("SnapTrade isn't configured (SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY missing).");
  }
  if (!client) {
    client = new Snaptrade({
      auth: SnaptradeAuth.commercialApiKey({
        clientId: process.env.SNAPTRADE_CLIENT_ID!,
        consumerKey: process.env.SNAPTRADE_CONSUMER_KEY!,
      }),
    });
  }
  return client;
}

/** Truncates a SnapTrade ISO timestamp to a plain YYYY-MM-DD date. */
function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export const snapTradeProvider: BrokerageProvider = {
  async registerUser(appUserId) {
    const res = await getClient().authentication.registerSnapTradeUser({ userId: appUserId });
    const userId = res.data.userId;
    const userSecret = res.data.userSecret;
    if (!userId || !userSecret) {
      throw new Error("SnapTrade did not return a user id/secret.");
    }
    return { externalUserId: userId, userSecret };
  },

  async connectionPortalUrl(creds, redirectUri) {
    const res = await getClient().authentication.loginSnapTradeUser({
      userId: creds.externalUserId,
      userSecret: creds.userSecret,
      customRedirect: redirectUri,
      connectionType: "read",
    });
    // The commercial-API-key auth mode always returns a plain redirect URI
    // (no end-user JWT to decrypt), but the SDK's return type is a union
    // with the encrypted-partner-key response shape — narrow it here.
    const data = res.data as { redirectURI?: string };
    if (!data.redirectURI) {
      throw new Error("SnapTrade did not return a connection portal URL.");
    }
    return data.redirectURI;
  },

  async listAccounts(creds) {
    const res = await getClient().accountInformation.listUserAccounts({
      userId: creds.externalUserId,
      userSecret: creds.userSecret,
    });
    return (res.data ?? []).map(
      (a): BrokerageAccount => ({
        externalId: a.id,
        name: a.name ?? a.institution_name ?? "Brokerage account",
        rawType: a.raw_type ?? null,
        inferredType: inferAccountType(a.raw_type ?? null),
        authorizationId: a.brokerage_authorization,
        institutionName: a.institution_name,
      })
    );
  },

  async fetchHoldings(creds, externalAccountId): Promise<FetchHoldingsResult> {
    const sdk = getClient();
    // `getUserAccountPositions` is deprecated in favor of the unified
    // `getAllAccountPositions` (multi-instrument-kind, discriminated by
    // `instrument.kind`) — no sunset date given, unlike
    // `getAccountActivities`'s dated deprecation. Deliberately not
    // switched yet: this slice has no live SnapTrade account to verify
    // the more complex discriminated-union response against, and this
    // endpoint's simpler `Position` shape is the one already checked
    // against the SDK's published docs. Revisit once there's a sandbox
    // account to test the swap against.
    const [positionsRes, balanceRes, activitiesRes] = await Promise.all([
      sdk.accountInformation.getUserAccountPositions({
        userId: creds.externalUserId,
        userSecret: creds.userSecret,
        accountId: externalAccountId,
      }),
      sdk.accountInformation.getUserAccountBalance({
        userId: creds.externalUserId,
        userSecret: creds.userSecret,
        accountId: externalAccountId,
      }),
      sdk.accountInformation.getAccountActivities({
        userId: creds.externalUserId,
        userSecret: creds.userSecret,
        accountId: externalAccountId,
        type: "BUY,SELL",
      }),
    ]);

    // Group BUY/SELL activities by ticker up front — `reconcileLots` runs
    // per position and needs only that position's own trade history.
    const activitiesByTicker = new Map<string, ActivityInput[]>();
    for (const a of activitiesRes.data?.data ?? []) {
      const ticker = a.symbol?.symbol;
      if (!ticker || !a.id || !a.trade_date || a.units == null || a.price == null) continue;
      const list = activitiesByTicker.get(ticker) ?? [];
      list.push({
        externalKey: a.id,
        type: a.type ?? "",
        tradeDate: toDateOnly(a.trade_date),
        units: Math.abs(a.units),
        pricePerShare: a.price,
      });
      activitiesByTicker.set(ticker, list);
    }

    const allLots: FetchHoldingsResult["lots"] = [];
    const warnings: string[] = [];

    for (const position of positionsRes.data ?? []) {
      const ticker = position.symbol?.symbol?.symbol;
      const shares = position.units;
      if (!ticker || shares == null || shares <= 0) continue; // skip shorts/empty/unresolvable symbols

      const rawTaxLots: RawTaxLot[] | null =
        position.tax_lots && position.tax_lots.length > 0
          ? position.tax_lots
              .filter((t) => t.original_purchase_date && t.quantity != null && t.purchased_price != null)
              .map((t) => ({
                externalKey: t.lot_id ?? `${ticker}:${t.original_purchase_date}:${t.quantity}`,
                shares: Number(t.quantity),
                costPerShare: Number(t.purchased_price),
                purchaseDate: toDateOnly(t.original_purchase_date!),
              }))
          : null;

      const { lots, warnings: lotWarnings } = reconcileLots(
        { ticker, shares, averageCostPerShare: position.average_purchase_price ?? position.price ?? 0 },
        rawTaxLots,
        activitiesByTicker.get(ticker) ?? []
      );
      allLots.push(...lots);
      warnings.push(...lotWarnings);
    }

    return {
      lots: allLots,
      cash: balanceRes.data?.[0]?.cash ?? null,
      warnings,
    };
  },
};

export { isConfigured as isSnapTradeConfigured };
