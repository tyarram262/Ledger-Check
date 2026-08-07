import { Snaptrade, SnaptradeAuth, type AccountUniversalActivity, type CommercialApiKeyAuth } from "snaptrade-typescript-sdk";
import { inferAccountType, type BrokerageAccount, type BrokerageProvider, type FetchHoldingsResult } from "@/lib/brokerage/types";
import { reconcileLots, type ActivityInput, type RawTaxLot } from "@/lib/brokerage/reconcileLots";
import { deriveSales, type DerivedSale } from "@/lib/brokerage/deriveSales";

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

const ACTIVITIES_PAGE_LIMIT = 1000;
const ACTIVITIES_MAX_PAGES = 10;

/**
 * Pages through `getAccountActivities` until the SDK-reported `total` is
 * exhausted (or a safety cap is hit). The unpaginated version of this call
 * relied on the SDK's default `limit` (1000) and ignored the response's
 * `pagination` block entirely — harmless for lot reconstruction (a shortfall
 * just became a `position-residual` lot), but silently truncating an active
 * account's SELL history is exactly the failure mode sales import exists to
 * avoid: a truncated-off loss sale is invisible to the wash-sale check with
 * no warning at all.
 */
async function fetchAllActivities(
  sdk: Snaptrade<CommercialApiKeyAuth>,
  creds: { externalUserId: string; userSecret: string },
  externalAccountId: string
): Promise<{ data: AccountUniversalActivity[]; warnings: string[] }> {
  const data: AccountUniversalActivity[] = [];
  let offset = 0;

  for (let page = 0; page < ACTIVITIES_MAX_PAGES; page++) {
    const res = await sdk.accountInformation.getAccountActivities({
      userId: creds.externalUserId,
      userSecret: creds.userSecret,
      accountId: externalAccountId,
      type: "BUY,SELL",
      offset,
      limit: ACTIVITIES_PAGE_LIMIT,
    });
    const pageData = res.data?.data ?? [];
    data.push(...pageData);
    const total = res.data?.pagination?.total ?? data.length;
    offset += pageData.length;
    if (pageData.length === 0 || offset >= total) {
      return { data, warnings: [] };
    }
  }

  return {
    data,
    warnings: [
      "This account's transaction history is unusually long — only the most recent activity was imported, so some older sales may be missing from tax and wash-sale checks.",
    ],
  };
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
    const [positionsRes, balanceRes, activities] = await Promise.all([
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
      fetchAllActivities(sdk, creds, externalAccountId),
    ]);

    const warnings: string[] = [...activities.warnings];

    // Group BUY/SELL activities by ticker up front — both `reconcileLots`
    // (per-position lots) and `deriveSales` (per-ticker sales) run on one
    // ticker's own trade history at a time.
    const activitiesByTicker = new Map<string, ActivityInput[]>();
    for (const a of activities.data) {
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

    // Sales are derived over *every* ticker with BUY/SELL history, not just
    // tickers with a live position — a fully-exited position's loss sale is
    // exactly the kind of history the wash-sale check needs, and the
    // position loop above never visits it.
    const allSales: DerivedSale[] = [];
    for (const [ticker, tickerActivities] of activitiesByTicker) {
      const { sales, warnings: saleWarnings } = deriveSales(ticker, tickerActivities);
      allSales.push(...sales);
      warnings.push(...saleWarnings);
    }

    return {
      lots: allLots,
      sales: allSales,
      cash: balanceRes.data?.[0]?.cash ?? null,
      warnings,
    };
  },

  async disconnectAuthorization(creds, authorizationId) {
    try {
      await getClient().connections.removeBrokerageAuthorization({
        authorizationId,
        userId: creds.externalUserId,
        userSecret: creds.userSecret,
      });
    } catch (err) {
      // Best-effort — see the doc comment on `BrokerageProvider.disconnectAuthorization`.
      // A 404-shaped error means SnapTrade already has no record of this
      // authorization (e.g. the user removed it brokerage-side), which is
      // the same end state we're trying to reach, not a failure.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status !== 404) throw err;
    }
  },
};

export { isConfigured as isSnapTradeConfigured };

/**
 * True when a SnapTrade API error means this connection's brokerage
 * authorization has been revoked or disabled — 401/403 from an
 * account-scoped call, since a merely-missing resource is a 404 (see
 * `disconnectAuthorization`'s own status check above) and everything else
 * (429, 5xx, network) is a transient failure, not a broken connection.
 * Used by `sync.ts`'s `syncOneAccount` to decide whether to flip
 * `brokerage_connections.disabled` — see that function's doc comment for
 * why this predicate, rather than "any fetchHoldings failure", is the
 * right trigger for a user-facing "needs attention" flag.
 */
export function isAuthRevokedError(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 401 || status === 403;
}
