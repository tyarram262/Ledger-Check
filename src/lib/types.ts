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

export type LotSource = "manual" | "csv" | "snaptrade";

export interface Lot {
  id: number;
  accountId: number;
  accountName: string;
  ticker: string;
  shares: number;
  costPerShare: number;
  /** ISO date (YYYY-MM-DD), or `null` when a brokerage sync couldn't
   *  determine a purchase date (shallow transaction history — see
   *  `reconcileLots.ts`). Null-dated lots are deliberately excluded from
   *  wash-sale and holding-period verdicts rather than given a fabricated
   *  date — see CLAUDE.md's "never estimate without labeling assumptions". */
  purchaseDate: string | null;
  source: LotSource;
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
