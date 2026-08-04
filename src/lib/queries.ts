import { createClient } from "@/lib/supabase/server";
import type { Account, AccountType, Lot, LotSource, Sale } from "@/lib/types";
import type { FilingStatus } from "@/lib/taxRates";
import { horizonReviewDate, type JournalEntry, type TimeHorizon } from "@/lib/journal";

interface AccountRow {
  id: number;
  name: string;
  type: AccountType;
  cash_balance: number;
}

function mapAccount(r: AccountRow): Account {
  return { id: r.id, name: r.name, type: r.type, cashBalance: r.cash_balance };
}

export async function listAccounts(): Promise<Account[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, type, cash_balance")
    .order("id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as AccountRow[]).map(mapAccount);
}

export async function createAccount(
  name: string,
  type: AccountType
): Promise<Account> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .insert({ name, type })
    .select("id, name, type, cash_balance")
    .single();
  if (error) throw new Error(error.message);
  return mapAccount(data as AccountRow);
}

/** Creates (or, on a rerun of Link for the same brokerage account, reuses)
 *  an account backed by a SnapTrade connection. `snaptrade_account_id` is
 *  unique per user so re-linking the same brokerage account is idempotent
 *  rather than creating a duplicate. */
export async function upsertSnapTradeAccount(input: {
  name: string;
  type: AccountType;
  snaptradeAccountId: string;
  connectionId: number;
}): Promise<Account> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .upsert(
      {
        name: input.name,
        type: input.type,
        snaptrade_account_id: input.snaptradeAccountId,
        connection_id: input.connectionId,
        sync_source: "snaptrade",
      },
      { onConflict: "user_id,snaptrade_account_id" }
    )
    .select("id, name, type, cash_balance")
    .single();
  if (error) throw new Error(error.message);
  return mapAccount(data as AccountRow);
}

/** Maps `accounts.snaptrade_account_id` -> local account id, for resolving
 *  which local account a sync response belongs to. */
export async function listSnapTradeAccountLinks(): Promise<
  { accountId: number; snaptradeAccountId: string; connectionId: number | null }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, snaptrade_account_id, connection_id")
    .not("snaptrade_account_id", "is", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    accountId: r.id as number,
    snaptradeAccountId: r.snaptrade_account_id as string,
    connectionId: r.connection_id as number | null,
  }));
}

/** Updates an account's cash balance. Returns false if the id doesn't
 *  resolve to a row the caller owns (RLS-scoped), not an error. */
export async function updateAccountCash(id: number, cashBalance: number): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .update({ cash_balance: cashBalance })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

interface LotRow {
  id: number;
  account_id: number;
  ticker: string;
  shares: number;
  cost_per_share: number;
  purchase_date: string | null;
  source: LotSource;
  accounts: { name: string } | null;
}

const LOT_SELECT = "id, account_id, ticker, shares, cost_per_share, purchase_date, source, accounts(name)";

function mapLot(r: LotRow): Lot {
  return {
    id: r.id,
    accountId: r.account_id,
    accountName: r.accounts?.name ?? "",
    ticker: r.ticker,
    shares: r.shares,
    costPerShare: r.cost_per_share,
    purchaseDate: r.purchase_date,
    source: r.source ?? "manual",
  };
}

export async function listLots(): Promise<Lot[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lots")
    .select(LOT_SELECT)
    .order("ticker")
    .order("purchase_date");
  if (error) throw new Error(error.message);
  return (data as unknown as LotRow[]).map(mapLot);
}

export async function createLot(input: {
  accountId: number;
  ticker: string;
  shares: number;
  costPerShare: number;
  purchaseDate: string;
  source?: LotSource;
}): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lots")
    .insert({
      account_id: input.accountId,
      ticker: input.ticker.toUpperCase(),
      shares: input.shares,
      cost_per_share: input.costPerShare,
      purchase_date: input.purchaseDate,
      source: input.source ?? "manual",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** Bulk insert (e.g. CSV import) as a single statement — atomic by default. */
export async function bulkCreateLots(
  accountId: number,
  lots: { ticker: string; shares: number; costPerShare: number; purchaseDate: string }[]
): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lots")
    .insert(
      lots.map((l) => ({
        account_id: accountId,
        ticker: l.ticker.toUpperCase(),
        shares: l.shares,
        cost_per_share: l.costPerShare,
        purchase_date: l.purchaseDate,
        source: "csv" as const,
      }))
    )
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

/**
 * Idempotent brokerage-sync upsert for one account's lots, keyed on
 * `(account_id, external_key)` rather than delete-and-reinsert. A wholesale
 * replace would be simpler, but `journal_entries.lot_id` is `ON DELETE SET
 * NULL` (see CLAUDE.md) — destroying and recreating every lot on each sync
 * would orphan a journal entry's link every single time, not just when a
 * position is genuinely closed. Only lots whose `external_key` no longer
 * appears in this sync are deleted (a position fully exited at the broker).
 */
export async function upsertSyncedLots(
  accountId: number,
  lots: {
    externalKey: string;
    ticker: string;
    shares: number;
    costPerShare: number;
    purchaseDate: string | null;
  }[]
): Promise<{ upserted: number; removed: number }> {
  const supabase = await createClient();

  if (lots.length > 0) {
    const { error: upsertError } = await supabase.from("lots").upsert(
      lots.map((l) => ({
        account_id: accountId,
        external_key: l.externalKey,
        ticker: l.ticker.toUpperCase(),
        shares: l.shares,
        cost_per_share: l.costPerShare,
        purchase_date: l.purchaseDate,
        source: "snaptrade" as const,
      })),
      { onConflict: "account_id,external_key" }
    );
    if (upsertError) throw new Error(upsertError.message);
  }

  // `external_key` values are broker-supplied (activity/lot ids, or a
  // `ticker:residual` fallback) — use `.notIn()` rather than hand-building
  // an `in (...)` filter string, so a value containing a reserved
  // PostgREST character (comma, quote, parenthesis) can't corrupt the
  // filter instead of just being excluded.
  const keptKeys = lots.map((l) => l.externalKey);
  let removeQuery = supabase
    .from("lots")
    .delete()
    .eq("account_id", accountId)
    .eq("source", "snaptrade")
    .not("external_key", "is", null)
    .select("id");
  if (keptKeys.length > 0) {
    removeQuery = removeQuery.notIn("external_key", keptKeys);
  }
  const { data: removedRows, error: removeError } = await removeQuery;
  if (removeError) throw new Error(removeError.message);

  return { upserted: lots.length, removed: (removedRows ?? []).length };
}

export async function deleteLot(id: number): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lots")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

interface SaleRow {
  id: number;
  account_id: number;
  ticker: string;
  shares: number;
  sale_price_per_share: number;
  cost_per_share: number;
  sale_date: string;
  realized_gain_loss: number;
  source: "manual" | "recorded";
  accounts: { name: string } | null;
}

function mapSale(r: SaleRow): Sale {
  return {
    id: r.id,
    accountId: r.account_id,
    accountName: r.accounts?.name ?? "",
    ticker: r.ticker,
    shares: r.shares,
    salePricePerShare: r.sale_price_per_share,
    costPerShare: r.cost_per_share,
    saleDate: r.sale_date,
    realizedGainLoss: r.realized_gain_loss,
    source: r.source,
  };
}

export async function listSales(): Promise<Sale[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales")
    .select(
      "id, account_id, ticker, shares, sale_price_per_share, cost_per_share, sale_date, realized_gain_loss, source, accounts(name)"
    )
    .order("sale_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown as SaleRow[]).map(mapSale);
}

export async function createSale(input: {
  accountId: number;
  ticker: string;
  shares: number;
  salePricePerShare: number;
  costPerShare: number;
  saleDate: string;
  source?: "manual" | "recorded";
}): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales")
    .insert({
      account_id: input.accountId,
      ticker: input.ticker.toUpperCase(),
      shares: input.shares,
      sale_price_per_share: input.salePricePerShare,
      cost_per_share: input.costPerShare,
      sale_date: input.saleDate,
      realized_gain_loss: (input.salePricePerShare - input.costPerShare) * input.shares,
      source: input.source ?? "manual",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function deleteSale(id: number): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function getConcentrationThreshold(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .select("concentration_threshold")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.concentration_threshold ?? 25;
}

export async function setConcentrationThreshold(value: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("settings")
    .upsert({ concentration_threshold: value }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

export interface Settings {
  concentrationThreshold: number;
  filingStatus: FilingStatus;
  annualTaxableIncome: number;
  stateTaxRate: number;
}

const DEFAULT_SETTINGS: Settings = {
  concentrationThreshold: 25,
  filingStatus: "single",
  annualTaxableIncome: 0,
  stateTaxRate: 0,
};

/** Full settings row, including the tax profile (Feature 2). Falls back to
 *  defaults when no row exists yet — not every user has one (see CLAUDE.md). */
export async function getSettings(): Promise<Settings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .select("concentration_threshold, filing_status, annual_taxable_income, state_tax_rate")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return DEFAULT_SETTINGS;
  return {
    concentrationThreshold: data.concentration_threshold,
    filingStatus: data.filing_status as FilingStatus,
    annualTaxableIncome: data.annual_taxable_income,
    stateTaxRate: data.state_tax_rate,
  };
}

/** Partial upsert — only the provided fields are written, so callers can
 *  update just the threshold (existing behavior) or just the tax profile. */
export async function updateSettings(input: Partial<Settings>): Promise<void> {
  const supabase = await createClient();
  const payload: Record<string, unknown> = {};
  if (input.concentrationThreshold !== undefined) payload.concentration_threshold = input.concentrationThreshold;
  if (input.filingStatus !== undefined) payload.filing_status = input.filingStatus;
  if (input.annualTaxableIncome !== undefined) payload.annual_taxable_income = input.annualTaxableIncome;
  if (input.stateTaxRate !== undefined) payload.state_tax_rate = input.stateTaxRate;
  const { error } = await supabase.from("settings").upsert(payload, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

export interface HealthSnapshotRow {
  snapshotDate: string;
  overall: number;
  diversification: number;
  taxEfficiency: number;
  concentration: number;
  sectorBalance: number;
  cashAllocation: number;
  /** Added 2026-08 — nullable because pre-existing snapshot rows can't be
   *  backfilled (no historical look-through to recompute risk from). */
  risk: number | null;
}

/** One row per user per day — a second write on the same day updates the
 *  existing row rather than creating a duplicate (`onConflict: "user_id,snapshot_date"`). */
export async function upsertHealthSnapshot(row: HealthSnapshotRow): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("health_snapshots").upsert(
    {
      snapshot_date: row.snapshotDate,
      overall: row.overall,
      diversification: row.diversification,
      tax_efficiency: row.taxEfficiency,
      concentration: row.concentration,
      sector_balance: row.sectorBalance,
      cash_allocation: row.cashAllocation,
      risk: row.risk,
    },
    { onConflict: "user_id,snapshot_date" }
  );
  if (error) throw new Error(error.message);
}

export async function listHealthSnapshots(limit = 30): Promise<HealthSnapshotRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("health_snapshots")
    .select("snapshot_date, overall, diversification, tax_efficiency, concentration, sector_balance, cash_allocation, risk")
    .order("snapshot_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => ({
      snapshotDate: r.snapshot_date,
      overall: r.overall,
      diversification: r.diversification,
      taxEfficiency: r.tax_efficiency,
      concentration: r.concentration,
      sectorBalance: r.sector_balance,
      cashAllocation: r.cash_allocation,
      risk: r.risk ?? null,
    }))
    .reverse(); // ascending (oldest first), for a left-to-right sparkline
}

interface JournalEntryRow {
  id: number;
  lot_id: number | null;
  ticker: string;
  account_id: number | null;
  shares: number | null;
  cost_per_share: number | null;
  purchase_date: string;
  reason: string;
  time_horizon: TimeHorizon;
  horizon_review_date: string | null;
  sell_trigger: string | null;
  risks: string | null;
  ai_review: string | null;
  source: "manual" | "simulator";
  created_at: string;
}

function mapJournalEntry(r: JournalEntryRow): JournalEntry {
  return {
    id: r.id,
    lotId: r.lot_id,
    ticker: r.ticker,
    accountId: r.account_id,
    shares: r.shares,
    costPerShare: r.cost_per_share,
    purchaseDate: r.purchase_date,
    reason: r.reason,
    timeHorizon: r.time_horizon,
    horizonReviewDate: r.horizon_review_date,
    sellTrigger: r.sell_trigger,
    risks: r.risks,
    aiReview: r.ai_review,
    source: r.source,
    createdAt: r.created_at,
  };
}

const JOURNAL_ENTRY_SELECT =
  "id, lot_id, ticker, account_id, shares, cost_per_share, purchase_date, reason, time_horizon, horizon_review_date, sell_trigger, risks, ai_review, source, created_at";

/** Creates (or, via the `lot_id` upsert, replaces) a journal entry for a
 *  lot the caller owns. `horizon_review_date` is computed here from
 *  `timeHorizon`, not passed in, so the label/duration mapping lives in
 *  exactly one place (`journal.ts`). */
export async function createJournalEntry(input: {
  lotId: number;
  ticker: string;
  accountId: number;
  shares: number;
  costPerShare: number;
  purchaseDate: string;
  reason: string;
  timeHorizon: TimeHorizon;
  sellTrigger?: string | null;
  risks?: string | null;
  aiReview?: string | null;
  source: "manual" | "simulator";
}): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journal_entries")
    .upsert(
      {
        lot_id: input.lotId,
        ticker: input.ticker.toUpperCase(),
        account_id: input.accountId,
        shares: input.shares,
        cost_per_share: input.costPerShare,
        purchase_date: input.purchaseDate,
        reason: input.reason,
        time_horizon: input.timeHorizon,
        horizon_review_date: horizonReviewDate(input.purchaseDate, input.timeHorizon),
        sell_trigger: input.sellTrigger ?? null,
        risks: input.risks ?? null,
        ai_review: input.aiReview ?? null,
        source: input.source,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "lot_id" }
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function listJournalEntries(): Promise<JournalEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journal_entries")
    .select(JOURNAL_ENTRY_SELECT)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown as JournalEntryRow[]).map(mapJournalEntry);
}

export async function deleteJournalEntry(id: number): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journal_entries")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** The current session's Supabase user id — needed as SnapTrade's
 *  `registerUser` `userId` (a separate namespace from `auth.uid()`, but
 *  reusing it is the simplest stable, immutable choice SnapTrade
 *  recommends against using an email for). */
export async function getCurrentUserId(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Not authenticated.");
  return data.user.id;
}

// --- Phase 2: SnapTrade brokerage sync -------------------------------

export interface SnapTradeCredentials {
  snaptradeUserId: string;
  userSecret: string;
}

/** `user_secret` grants read access to the user's live brokerage data —
 *  never select this into a client component or log it (see CLAUDE.md's
 *  "encrypt brokerage tokens" Phase 3 item, which applies to this column). */
export async function getSnapTradeCredentials(): Promise<SnapTradeCredentials | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("snaptrade_users")
    .select("snaptrade_user_id, user_secret")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { snaptradeUserId: data.snaptrade_user_id, userSecret: data.user_secret };
}

export async function saveSnapTradeCredentials(creds: SnapTradeCredentials): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("snaptrade_users").upsert(
    { snaptrade_user_id: creds.snaptradeUserId, user_secret: creds.userSecret },
    { onConflict: "user_id" }
  );
  if (error) throw new Error(error.message);
}

export interface BrokerageConnectionRow {
  id: number;
  authorizationId: string;
  brokerageName: string | null;
  disabled: boolean;
  lastSyncedAt: string | null;
}

export async function listBrokerageConnections(): Promise<BrokerageConnectionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brokerage_connections")
    .select("id, authorization_id, brokerage_name, disabled, last_synced_at")
    .order("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    authorizationId: r.authorization_id,
    brokerageName: r.brokerage_name,
    disabled: r.disabled,
    lastSyncedAt: r.last_synced_at,
  }));
}

/** Idempotent on `authorization_id` — SnapTrade's connection portal can
 *  redirect back to us more than once for the same authorization. */
export async function upsertBrokerageConnection(input: {
  authorizationId: string;
  brokerageName: string | null;
}): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brokerage_connections")
    .upsert(
      { authorization_id: input.authorizationId, brokerage_name: input.brokerageName },
      { onConflict: "user_id,authorization_id" }
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function touchConnectionSynced(connectionId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("brokerage_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", connectionId);
  if (error) throw new Error(error.message);
}
