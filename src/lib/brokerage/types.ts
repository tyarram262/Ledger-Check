import type { AccountType } from "@/lib/types";
import type { DerivedSale } from "@/lib/brokerage/deriveSales";

/**
 * Provider-neutral brokerage-sync types (Phase 2 of the roadmap in
 * CLAUDE.md). `BrokerageProvider` is the seam a second provider (or a
 * non-SnapTrade source like Plaid) would implement without touching any
 * caller — `snaptrade.ts` is the only file that knows SnapTrade's actual
 * request/response shapes.
 */

export interface BrokerageCredentials {
  externalUserId: string;
  userSecret: string;
}

export interface BrokerageAccount {
  externalId: string;
  name: string;
  /** The account type string as reported by the brokerage, verbatim —
   *  varies by brokerage and is not normalized. Shown to the user
   *  alongside `inferredType` so they can correct a wrong guess. */
  rawType: string | null;
  /** Best-effort guess from `rawType`. Never used to write an account
   *  without user confirmation — see the account-link flow in
   *  `/api/brokerage/link` — because a wrong guess here would silently
   *  corrupt every wash-sale and IRA-permanent-loss verdict for the
   *  account. */
  inferredType: AccountType | null;
  /** Identifies which brokerage connection (login) this account came
   *  from — used to upsert `brokerage_connections` before linking. */
  authorizationId: string;
  institutionName: string;
}

/** How a reconciled lot's purchase date was determined — surfaced so the
 *  UI/estimates can be honest about confidence, not just the date itself. */
export type LotBasis = "tax-lot" | "activity-replay" | "position-residual";

export interface BrokerageLot {
  /** Stable per-account key used for the idempotent upsert in
   *  `upsertSyncedLots` (`queries.ts`) — must not change between syncs of
   *  the same underlying lot, or every re-sync would duplicate it. */
  externalKey: string;
  ticker: string;
  shares: number;
  costPerShare: number;
  /** `null` when no purchase date could be determined — see
   *  `reconcileLots.ts`. Never fabricated. */
  purchaseDate: string | null;
  basis: LotBasis;
}

export interface FetchHoldingsResult {
  lots: BrokerageLot[];
  cash: number | null;
  /** Realized sales reconstructed from BUY/SELL activity history — see
   *  `deriveSales.ts`. Covers *every* ticker with SELL activity in the
   *  fetched window, not just tickers still held (a fully-exited position's
   *  loss sale is exactly the kind of history a wash-sale check needs). */
  sales: DerivedSale[];
  /** Human-readable notes about any reconciliation shortcuts taken for
   *  this account (e.g. "12 shares of AAPL have no known purchase date") —
   *  surfaced to the user, not swallowed. */
  warnings: string[];
}

export interface BrokerageProvider {
  /** Registers (or returns the existing) provider-side user for this app
   *  user. Idempotent per `appUserId`. */
  registerUser(appUserId: string): Promise<BrokerageCredentials>;
  /** Connection Portal URL for the user to link a brokerage account.
   *  `redirectUri` is where the portal sends them back afterward. */
  connectionPortalUrl(creds: BrokerageCredentials, redirectUri: string): Promise<string>;
  listAccounts(creds: BrokerageCredentials): Promise<BrokerageAccount[]>;
  fetchHoldings(creds: BrokerageCredentials, externalAccountId: string): Promise<FetchHoldingsResult>;
  /** Fully removes a brokerage authorization at the provider — the user is
   *  disconnecting, not just pausing sync (that would be a "disable", a
   *  different, less final operation this app doesn't expose). Should be
   *  treated as best-effort by the caller: the provider may have already
   *  revoked the authorization on its end (e.g. the user removed it from
   *  the brokerage's own app), which isn't a reason to block local
   *  cleanup. */
  disconnectAuthorization(creds: BrokerageCredentials, authorizationId: string): Promise<void>;
}

/**
 * Best-effort mapping from a brokerage's free-text account type string to
 * our three-way `AccountType`. Deliberately conservative: anything that
 * isn't recognizably a Roth or a traditional/rollover IRA defaults to
 * `"taxable"` (the common case) rather than guessing at other tax-
 * advantaged account types (401k, HSA, SEP-IRA, ...) this app doesn't
 * model — those still land on `"taxable"` and the user is expected to
 * catch the mismatch during the required confirm step (see
 * `BrokerageAccount.inferredType`'s doc comment).
 */
export function inferAccountType(rawType: string | null): AccountType {
  if (!rawType) return "taxable";
  const t = rawType.toLowerCase();
  if (t.includes("roth")) return "roth";
  if (t.includes("ira") || t.includes("rollover")) return "traditional_ira";
  return "taxable";
}
