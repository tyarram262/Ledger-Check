import type { Account, Lot, Sale } from "@/lib/types";
import { addDays, daysBetween } from "@/lib/dates";

export const WASH_SALE_WINDOW_DAYS = 30;

export interface SimulatedTrade {
  side: "buy" | "sell";
  ticker: string;
  shares: number;
  pricePerShare: number;
  /** Account the trade executes in — required for sells (determines which
   *  lots are sold), also used on buys to detect the IRA-permanent case. */
  accountId?: number;
}

export interface WashSaleTrigger {
  date: string;
  accountName: string;
  description: string;
  /** Whether this specific triggering account is an IRA. */
  isIra: boolean;
}

export interface WashSaleWarning {
  kind: "buy-after-loss" | "sell-with-recent-buy";
  ticker: string;
  triggers: WashSaleTrigger[];
  /** First date the trade could execute without wash-sale risk. */
  windowClearsOn: string;
  message: string;
  /**
   * Rev. Rul. 2008-5: when the replacement shares sit in an IRA, the loss is
   * permanently disallowed rather than deferred into a new cost basis — a
   * materially worse outcome than a same-taxable-account wash sale.
   */
  isIraPermanent: boolean;
}

function isIraAccount(accounts: Account[], accountId: number | undefined): boolean {
  if (accountId == null) return false;
  const account = accounts.find((a) => a.id === accountId);
  return account?.type === "roth" || account?.type === "traditional_ira";
}

/** FIFO preview of a sell: which shares would go, and at what average basis. */
export interface SellPreview {
  sharesSold: number;
  sharesHeld: number;
  avgCostPerShare: number;
  realizedGainLoss: number;
  /** Lots (or partial lots) that remain held after the sell. */
  remainingLots: { lot: Lot; remainingShares: number }[];
}

export function previewFifoSell(
  trade: SimulatedTrade,
  lots: Lot[]
): SellPreview {
  const ticker = trade.ticker.toUpperCase();
  const accountLots = lots
    .filter((l) => l.ticker === ticker && l.accountId === trade.accountId)
    .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate));

  const sharesHeld = accountLots.reduce((sum, l) => sum + l.shares, 0);
  let toSell = Math.min(trade.shares, sharesHeld);
  const sharesSold = toSell;
  let costOfSold = 0;
  const remainingLots: { lot: Lot; remainingShares: number }[] = [];

  for (const lot of accountLots) {
    const sold = Math.min(lot.shares, toSell);
    costOfSold += sold * lot.costPerShare;
    toSell -= sold;
    if (lot.shares - sold > 0) {
      remainingLots.push({ lot, remainingShares: lot.shares - sold });
    }
  }

  const avgCostPerShare = sharesSold > 0 ? costOfSold / sharesSold : 0;
  return {
    sharesSold,
    sharesHeld,
    avgCostPerShare,
    realizedGainLoss: (trade.pricePerShare - avgCostPerShare) * sharesSold,
    remainingLots,
  };
}

/**
 * Wash-sale check for a hypothetical trade, as of `today`.
 *
 * Buy side: a buy is flagged when the same ticker was sold at a loss within
 * the past 30 days in ANY account (cross-account, including IRAs).
 *
 * Sell side: a sell at a loss is flagged when shares of the same ticker were
 * purchased within the past 30 days in ANY account and would still be held
 * after the sale (replacement shares).
 *
 * Binary check by design: any match flags, regardless of share counts. The
 * real rule disallows the loss proportionally to replacement shares.
 *
 * Whichever side supplies the replacement shares, if that account is an IRA
 * the loss is permanently disallowed (Rev. Rul. 2008-5) rather than deferred
 * into a new cost basis — flagged via `isIraPermanent`.
 */
export function checkWashSale(
  trade: SimulatedTrade,
  sales: Sale[],
  lots: Lot[],
  accounts: Account[],
  today: string
): WashSaleWarning | null {
  const ticker = trade.ticker.toUpperCase();

  if (trade.side === "buy") {
    const lossSales = sales.filter(
      (s) =>
        s.ticker === ticker &&
        s.realizedGainLoss < 0 &&
        daysBetween(s.saleDate, today) >= 0 &&
        daysBetween(s.saleDate, today) <= WASH_SALE_WINDOW_DAYS
    );
    if (lossSales.length === 0) return null;

    // The replacement shares are this buy itself — its account is what matters.
    const isIraPermanent = isIraAccount(accounts, trade.accountId);
    const triggers = lossSales.map((s) => ({
      date: s.saleDate,
      accountName: s.accountName,
      description: `Sold ${s.shares} ${ticker} at a $${Math.abs(s.realizedGainLoss).toFixed(2)} loss in ${s.accountName}`,
      isIra: isIraAccount(accounts, s.accountId),
    }));
    const latestSaleDate = lossSales
      .map((s) => s.saleDate)
      .sort()
      .at(-1)!;
    const windowClearsOn = addDays(latestSaleDate, WASH_SALE_WINDOW_DAYS + 1);
    return {
      kind: "buy-after-loss",
      ticker,
      triggers,
      windowClearsOn,
      isIraPermanent,
      message: isIraPermanent
        ? `Buying ${ticker} now would trigger a wash sale — and because the repurchase is in an IRA, the loss from your ${latestSaleDate} sale is PERMANENTLY disallowed (it can never be added back to cost basis, per Rev. Rul. 2008-5). The window clears on ${windowClearsOn}.`
        : `Buying ${ticker} now would trigger a wash sale — the loss from your ${latestSaleDate} sale would be disallowed and rolled into the cost basis of these new shares. The window clears on ${windowClearsOn}.`,
    };
  }

  // Sell side: only relevant when the sale realizes a loss.
  const preview = previewFifoSell(trade, lots);
  if (preview.sharesSold === 0 || preview.realizedGainLoss >= 0) return null;

  // Replacement shares: same ticker bought in the past 30 days (any account)
  // that would still be held after this sale.
  const remainingByLotId = new Map(
    preview.remainingLots.map((r) => [r.lot.id, r.remainingShares])
  );
  const recentBuys = lots.filter((l) => {
    if (l.ticker !== ticker) return false;
    const age = daysBetween(l.purchaseDate, today);
    if (age < 0 || age > WASH_SALE_WINDOW_DAYS) return false;
    const stillHeld =
      l.accountId === trade.accountId
        ? (remainingByLotId.get(l.id) ?? 0) > 0
        : true; // lots in other accounts are untouched by this sale
    return stillHeld;
  });
  if (recentBuys.length === 0) return null;

  const triggers = recentBuys.map((l) => ({
    date: l.purchaseDate,
    accountName: l.accountName,
    description: `Bought ${l.shares} ${ticker} in ${l.accountName}`,
    isIra: isIraAccount(accounts, l.accountId),
  }));
  // The replacement shares are these recent buys — permanent if any sit in an IRA.
  const isIraPermanent = triggers.some((t) => t.isIra);
  const latestBuyDate = recentBuys
    .map((l) => l.purchaseDate)
    .sort()
    .at(-1)!;
  const windowClearsOn = addDays(latestBuyDate, WASH_SALE_WINDOW_DAYS + 1);
  return {
    kind: "sell-with-recent-buy",
    ticker,
    triggers,
    windowClearsOn,
    isIraPermanent,
    message: isIraPermanent
      ? `Selling ${ticker} at a loss now would trigger a wash sale — you bought shares on ${latestBuyDate} in an IRA that you'd still hold, so the loss is PERMANENTLY disallowed (per Rev. Rul. 2008-5), not just deferred. The window clears on ${windowClearsOn}.`
      : `Selling ${ticker} at a loss now would trigger a wash sale — you bought shares on ${latestBuyDate} that you'd still hold, so the loss would be disallowed and added to those shares' cost basis. The window clears on ${windowClearsOn}.`,
  };
}
