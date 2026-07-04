import { getDb } from "@/lib/db";
import type { Account, AccountType, Lot, Sale } from "@/lib/types";

export function listAccounts(): Account[] {
  const rows = getDb()
    .prepare("SELECT id, name, type FROM accounts ORDER BY id")
    .all() as unknown as Account[];
  return rows;
}

export function createAccount(name: string, type: AccountType): Account {
  const result = getDb()
    .prepare("INSERT INTO accounts (name, type) VALUES (?, ?)")
    .run(name, type);
  return { id: Number(result.lastInsertRowid), name, type };
}

interface LotRow {
  id: number;
  account_id: number;
  account_name: string;
  ticker: string;
  shares: number;
  cost_per_share: number;
  purchase_date: string;
}

export function listLots(): Lot[] {
  const rows = getDb()
    .prepare(
      `SELECT l.id, l.account_id, a.name AS account_name, l.ticker,
              l.shares, l.cost_per_share, l.purchase_date
       FROM lots l JOIN accounts a ON a.id = l.account_id
       ORDER BY l.ticker, l.purchase_date`
    )
    .all() as unknown as LotRow[];
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    accountName: r.account_name,
    ticker: r.ticker,
    shares: r.shares,
    costPerShare: r.cost_per_share,
    purchaseDate: r.purchase_date,
  }));
}

export function createLot(input: {
  accountId: number;
  ticker: string;
  shares: number;
  costPerShare: number;
  purchaseDate: string;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO lots (account_id, ticker, shares, cost_per_share, purchase_date)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      input.accountId,
      input.ticker.toUpperCase(),
      input.shares,
      input.costPerShare,
      input.purchaseDate
    );
  return Number(result.lastInsertRowid);
}

export function deleteLot(id: number): boolean {
  const result = getDb().prepare("DELETE FROM lots WHERE id = ?").run(id);
  return result.changes > 0;
}

interface SaleRow {
  id: number;
  account_id: number;
  account_name: string;
  ticker: string;
  shares: number;
  sale_price_per_share: number;
  cost_per_share: number;
  sale_date: string;
  realized_gain_loss: number;
  source: "manual" | "recorded";
}

export function listSales(): Sale[] {
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.account_id, a.name AS account_name, s.ticker, s.shares,
              s.sale_price_per_share, s.cost_per_share, s.sale_date,
              s.realized_gain_loss, s.source
       FROM sales s JOIN accounts a ON a.id = s.account_id
       ORDER BY s.sale_date DESC`
    )
    .all() as unknown as SaleRow[];
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    accountName: r.account_name,
    ticker: r.ticker,
    shares: r.shares,
    salePricePerShare: r.sale_price_per_share,
    costPerShare: r.cost_per_share,
    saleDate: r.sale_date,
    realizedGainLoss: r.realized_gain_loss,
    source: r.source,
  }));
}

export function createSale(input: {
  accountId: number;
  ticker: string;
  shares: number;
  salePricePerShare: number;
  costPerShare: number;
  saleDate: string;
  source?: "manual" | "recorded";
}): number {
  const realized =
    (input.salePricePerShare - input.costPerShare) * input.shares;
  const result = getDb()
    .prepare(
      `INSERT INTO sales (account_id, ticker, shares, sale_price_per_share,
                          cost_per_share, sale_date, realized_gain_loss, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.accountId,
      input.ticker.toUpperCase(),
      input.shares,
      input.salePricePerShare,
      input.costPerShare,
      input.saleDate,
      realized,
      input.source ?? "manual"
    );
  return Number(result.lastInsertRowid);
}

export function deleteSale(id: number): boolean {
  const result = getDb().prepare("DELETE FROM sales WHERE id = ?").run(id);
  return result.changes > 0;
}
