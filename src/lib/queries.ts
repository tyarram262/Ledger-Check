import { createClient } from "@/lib/supabase/server";
import type { Account, AccountType, Lot, Sale } from "@/lib/types";
import type { FilingStatus } from "@/lib/taxRates";

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
  purchase_date: string;
  accounts: { name: string } | null;
}

function mapLot(r: LotRow): Lot {
  return {
    id: r.id,
    accountId: r.account_id,
    accountName: r.accounts?.name ?? "",
    ticker: r.ticker,
    shares: r.shares,
    costPerShare: r.cost_per_share,
    purchaseDate: r.purchase_date,
  };
}

export async function listLots(): Promise<Lot[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lots")
    .select("id, account_id, ticker, shares, cost_per_share, purchase_date, accounts(name)")
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
      }))
    )
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
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
    },
    { onConflict: "user_id,snapshot_date" }
  );
  if (error) throw new Error(error.message);
}

export async function listHealthSnapshots(limit = 30): Promise<HealthSnapshotRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("health_snapshots")
    .select("snapshot_date, overall, diversification, tax_efficiency, concentration, sector_balance, cash_allocation")
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
    }))
    .reverse(); // ascending (oldest first), for a left-to-right sparkline
}
