export type AccountType = "taxable" | "roth" | "traditional_ira";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  taxable: "Taxable",
  roth: "Roth IRA",
  traditional_ira: "Traditional IRA",
};

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  cashBalance: number;
}

export interface Lot {
  id: number;
  accountId: number;
  accountName: string;
  ticker: string;
  shares: number;
  costPerShare: number;
  purchaseDate: string; // ISO date (YYYY-MM-DD)
}

export interface Sale {
  id: number;
  accountId: number;
  accountName: string;
  ticker: string;
  shares: number;
  salePricePerShare: number;
  costPerShare: number;
  saleDate: string; // ISO date (YYYY-MM-DD)
  realizedGainLoss: number;
  source: "manual" | "recorded";
}
