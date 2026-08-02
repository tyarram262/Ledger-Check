import type { Account, Lot, Sale } from "@/lib/types";
import {
  concentrationVerdict,
  sectorAllocation,
  DEFAULT_ELEVATED_THRESHOLD,
  type ConcentrationVerdict,
  type SectorSlice,
} from "@/lib/concentration";
import { NON_CONCENTRATION_SECTORS, sectorFor } from "@/lib/sectors";
import {
  checkWashSale,
  previewFifoSell,
  WASH_SALE_WINDOW_DAYS,
  type SimulatedTrade,
  type WashSaleWarning,
} from "@/lib/washSale";
import { addDays } from "@/lib/dates";
import { buildPositions } from "@/lib/valuation";
import { computeOverlap, lookThroughPositions, type OverlapResult } from "@/lib/etfOverlap";
import { checkTax, type TaxCheckResult } from "@/lib/taxCheck";
import { diversificationScore, riskScore, type SubScore } from "@/lib/scores";
import { DEFAULT_TAX_PROFILE, type TaxProfile } from "@/lib/taxRates";

export type Severity = "ok" | "caution" | "warning";

export interface AllocationSnapshot {
  slices: SectorSlice[];
  verdict: ConcentrationVerdict;
}

export interface ScoreDelta {
  before: SubScore;
  after: SubScore;
}

export interface SimulationResult {
  before: AllocationSnapshot;
  after: AllocationSnapshot;
  washSale: WashSaleWarning | null;
  verdictSentence: string;
  severity: Severity;
  /** For loss sells that don't currently trigger: forward-looking caution. */
  futureRebuyNote: string | null;
  sellPreview: {
    sharesSold: number;
    avgCostPerShare: number;
    realizedGainLoss: number;
  } | null;
  /** ETF look-through overlap for the traded ticker (Feature 1). */
  etfOverlap: OverlapResult;
  /** Wash-sale + holding-period + estimated-tax detail — sells only. */
  taxCheck: TaxCheckResult | null;
  /** Before/after diversification and risk sub-scores for this trade (Feature 1). */
  scores: {
    diversification: ScoreDelta;
    risk: ScoreDelta;
  };
}

export type SimulationOutcome =
  | { ok: true; result: SimulationResult }
  | { ok: false; error: string };

function pctOf(slices: SectorSlice[], sector: string): number {
  return slices.find((s) => s.sector === sector)?.pct ?? 0;
}

export function simulateTrade(
  trade: SimulatedTrade,
  lots: Lot[],
  sales: Sale[],
  accounts: Account[],
  today: string,
  prices: Map<string, number> = new Map(),
  elevatedThreshold: number = DEFAULT_ELEVATED_THRESHOLD,
  profile: TaxProfile = DEFAULT_TAX_PROFILE
): SimulationOutcome {
  const ticker = trade.ticker.toUpperCase();
  const sector = sectorFor(ticker);

  const beforePositions = buildPositions(lots, prices);

  // "After" portfolio: a buy adds what you'd pay; a sell removes the value of
  // the shares sold (at the live price when known, else their cost basis) —
  // proceeds become untracked cash.
  const afterPositions = [...beforePositions];
  let sellPreview: SimulationResult["sellPreview"] = null;

  if (trade.side === "buy") {
    afterPositions.push({ ticker, value: trade.shares * trade.pricePerShare });
  } else {
    if (!trade.accountId) {
      return { ok: false, error: "Pick the account you'd sell from." };
    }
    const preview = previewFifoSell(trade, lots);
    if (preview.sharesHeld === 0) {
      return {
        ok: false,
        error: `You don't hold any ${ticker} in that account.`,
      };
    }
    if (trade.shares > preview.sharesHeld) {
      return {
        ok: false,
        error: `You only hold ${preview.sharesHeld} shares of ${ticker} in that account.`,
      };
    }
    sellPreview = {
      sharesSold: preview.sharesSold,
      avgCostPerShare: preview.avgCostPerShare,
      realizedGainLoss: preview.realizedGainLoss,
    };
    const unitValue = prices.get(ticker) ?? preview.avgCostPerShare;
    afterPositions.push({ ticker, value: -(preview.sharesSold * unitValue) });
  }

  const before: AllocationSnapshot = (() => {
    const slices = sectorAllocation(beforePositions);
    return { slices, verdict: concentrationVerdict(slices, elevatedThreshold) };
  })();
  const after: AllocationSnapshot = (() => {
    const slices = sectorAllocation(afterPositions);
    return { slices, verdict: concentrationVerdict(slices, elevatedThreshold) };
  })();

  const washSale = checkWashSale(trade, sales, lots, accounts, today);

  // One-sentence verdict: concentration move + wash-sale outcome.
  const beforePct = pctOf(before.slices, sector);
  const afterPct = pctOf(after.slices, sector);
  const isSectorBet = !NON_CONCENTRATION_SECTORS.has(sector);
  const noun = isSectorBet ? `${sector} exposure` : `${sector} allocation`;
  let move: string;
  if (Math.round(afterPct) === Math.round(beforePct)) {
    move = `This trade would leave your ${noun} at about ${Math.round(afterPct)}%`;
  } else if (afterPct > beforePct) {
    move = `This trade would push your ${noun} from ${Math.round(beforePct)}% to ${Math.round(afterPct)}%`;
  } else {
    move = `This trade would lower your ${noun} from ${Math.round(beforePct)}% to ${Math.round(afterPct)}%`;
  }

  let washClause: string;
  if (washSale?.kind === "buy-after-loss") {
    const t = washSale.triggers.at(-1)!;
    washClause = washSale.isIraPermanent
      ? ` and would trigger a wash sale — because the repurchase is in an IRA, the loss from your ${t.date} ${ticker} sale in ${t.accountName} would be PERMANENTLY disallowed`
      : ` and would trigger a wash sale — the loss from your ${t.date} ${ticker} sale in ${t.accountName} would be disallowed`;
  } else if (washSale?.kind === "sell-with-recent-buy") {
    const t = washSale.triggers.at(-1)!;
    washClause = washSale.isIraPermanent
      ? ` and would trigger a wash sale — you bought ${ticker} on ${t.date} in an IRA (${t.accountName}), so this loss would be PERMANENTLY disallowed`
      : ` and would trigger a wash sale — you bought ${ticker} on ${t.date} (${t.accountName}), so this loss would be disallowed`;
  } else {
    washClause = " and doesn't trigger a wash sale";
  }
  const verdictSentence = `${move}${washClause}.`;

  const severity: Severity = washSale
    ? "warning"
    : after.verdict.level === "high"
      ? "warning"
      : after.verdict.level === "elevated"
        ? "caution"
        : "ok";

  const futureRebuyNote =
    trade.side === "sell" && !washSale && (sellPreview?.realizedGainLoss ?? 0) < 0
      ? `Heads up: this sale realizes a loss. If you rebuy ${ticker} in any account before ${addDays(today, WASH_SALE_WINDOW_DAYS + 1)}, that loss would be disallowed as a wash sale.`
      : null;

  const etfOverlap = computeOverlap(ticker, beforePositions, afterPositions);
  const taxCheck = trade.side === "sell" ? checkTax(trade, lots, sales, accounts, profile, today) : null;

  const scores = {
    diversification: {
      before: diversificationScore(lookThroughPositions(beforePositions), lots),
      after: diversificationScore(lookThroughPositions(afterPositions), lots),
    },
    risk: {
      before: riskScore(lookThroughPositions(beforePositions), before.slices),
      after: riskScore(lookThroughPositions(afterPositions), after.slices),
    },
  };

  // Escalate severity for tax signals that don't already show up as a wash
  // sale or a concentration flag — a real short-term-gain tax hit deserves
  // at least a caution even on an otherwise clean, well-diversified trade.
  const finalSeverity: Severity =
    severity === "ok" && taxCheck?.shortTermWarning ? "caution" : severity;

  return {
    ok: true,
    result: {
      before,
      after,
      washSale,
      verdictSentence,
      severity: finalSeverity,
      futureRebuyNote,
      sellPreview,
      etfOverlap,
      taxCheck,
      scores,
    },
  };
}
