import { createClient } from "@/lib/supabase/server";
import type { Account, AccountType, Lot, Sale } from "@/lib/types";

export async function listAccounts(): Promise<Account[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, type")
    .order("id");
  if (error) throw new Error(error.message);
  return (data ?? []) as Account[];
}

export async function createAccount(
  name: string,
  type: AccountType
): Promise<Account> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .insert({ name, type })
    .select("id, name, type")
    .single();
  if (error) throw new Error(error.message);
  return data;
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
