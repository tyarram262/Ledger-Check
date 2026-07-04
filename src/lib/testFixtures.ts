import type { Lot, Sale } from "@/lib/types";

let nextId = 1;

export function makeLot(over: Partial<Lot> = {}): Lot {
  return {
    id: nextId++,
    accountId: 1,
    accountName: "Taxable Brokerage",
    ticker: "AAPL",
    shares: 10,
    costPerShare: 100,
    purchaseDate: "2025-01-01",
    ...over,
  };
}

export function makeSale(over: Partial<Sale> = {}): Sale {
  const base = {
    id: nextId++,
    accountId: 1,
    accountName: "Taxable Brokerage",
    ticker: "AAPL",
    shares: 10,
    salePricePerShare: 90,
    costPerShare: 100,
    saleDate: "2026-06-20",
    source: "manual" as const,
  };
  const merged = { ...base, ...over };
  return {
    realizedGainLoss:
      (merged.salePricePerShare - merged.costPerShare) * merged.shares,
    ...merged,
  };
}
