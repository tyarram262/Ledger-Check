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
  /** True for accounts seeded by "Load a sample portfolio" on the
   *  first-run zero-state (`samplePortfolio.ts`) — lets the UI show a
   *  removable-sample-data banner and scopes `deleteSampleAccounts`. */
  isSample: boolean;
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
  /** `null` when a brokerage sync's activity history couldn't fully explain
   *  what was sold (see `deriveSales.ts`) — never a fabricated/blended
   *  guess. A null basis means `realizedGainLoss` is also null. */
  costPerShare: number | null;
  /** ISO date (YYYY-MM-DD) of the earliest lot this sale's shares came
   *  from, when known — populated by brokerage sync only; manually
   *  recorded/entered sales leave this `null` today (see CLAUDE.md: tax
   *  efficiency is computed from unrealized lots only, this is a step
   *  toward closing that gap for synced accounts). */
  acquiredDate: string | null;
  saleDate: string; // ISO date (YYYY-MM-DD)
  /** `null` exactly when `costPerShare` is `null`. */
  realizedGainLoss: number | null;
  source: "manual" | "recorded" | "snaptrade";
}
