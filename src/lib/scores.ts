import type { Account, Lot } from "@/lib/types";
import type { Position, SectorSlice } from "@/lib/concentration";
import { concentrationVerdict, HIGH_THRESHOLD_MULTIPLIER } from "@/lib/concentration";
import { NON_CONCENTRATION_SECTORS, sectorFor } from "@/lib/sectors";
import { termFor } from "@/lib/holdingPeriod";
import { shortTermRate, type TaxProfile } from "@/lib/taxRates";

/**
 * Deterministic, explainable portfolio scoring — no LLM in this path (the
 * Claude digest in `digest.ts` is separate free-text prose). Every
 * `SubScore.score` is 0-100 where **higher always means healthier**,
 * including `riskScore` — a high risk *score* means low risk, so every
 * sub-score can be graded on the same A-F curve.
 */

export type Grade = "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-" | "D" | "F";

export interface SubScore {
  key: string;
  label: string;
  score: number; // 0-100, higher is healthier
  grade: Grade;
  sentence: string;
}

export interface HealthScore {
  overall: number;
  overallGrade: Grade;
  subScores: SubScore[];
  computedAt: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const GRADE_BANDS: [number, Grade][] = [
  [93, "A"],
  [90, "A-"],
  [87, "B+"],
  [83, "B"],
  [80, "B-"],
  [77, "C+"],
  [73, "C"],
  [70, "C-"],
  [60, "D"],
  [0, "F"],
];

export function gradeFor(score: number): Grade {
  for (const [min, grade] of GRADE_BANDS) {
    if (score >= min) return grade;
  }
  return "F";
}

function isIraAccount(accounts: Account[], accountId: number): boolean {
  const account = accounts.find((a) => a.id === accountId);
  return account?.type === "roth" || account?.type === "traditional_ira";
}

/** Weight not covered by our top-holdings data gets bucketed as
 *  `<TICKER>:UNATTRIBUTED` by `etfOverlap.ts`'s look-through expansion. */
function isUnattributedBucket(ticker: string): boolean {
  return ticker.endsWith(":UNATTRIBUTED");
}

// Effective-holdings target (via Herfindahl-Hirschman Index) for a perfect
// diversification score — roughly "12 equally-weighted positions", which is
// within common retail guidance for a diversified individual-stock
// portfolio; broad-index exposure clears this easily via look-through.
const DIVERSIFICATION_TARGET_EFFECTIVE_N = 12;
const TOP_HOLDING_PENALTY_THRESHOLD = 15; // percent
const TOP_HOLDING_PENALTY_RATE = 1.5; // score points lost per point over the threshold

/**
 * Diversification: how spread out the portfolio is across *names*, via
 * look-through (an ETF's constituents count, not just the wrapper). This is
 * deliberately independent of sector — a tech-heavy but 100-holding index
 * fund scores well here even though it may score poorly on concentration.
 */
export function diversificationScore(lookThrough: Position[], lots: Lot[]): SubScore {
  if (lots.length === 0) {
    return {
      key: "diversification",
      label: "Diversification",
      score: 0,
      grade: gradeFor(0),
      sentence: "Add holdings to see a diversification score.",
    };
  }
  const total = lookThrough.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  if (total <= 0) {
    return {
      key: "diversification",
      label: "Diversification",
      score: 0,
      grade: gradeFor(0),
      sentence: "Add holdings to see a diversification score.",
    };
  }
  // Unattributed ETF residual is treated as inherently diversified — real
  // funds hold hundreds of names there — so it dilutes concentration
  // without itself counting as one big position, matching how a broad
  // index fund actually behaves. ETFs with NO holdings data (e.g. GLD) are
  // NOT split into a residual and so remain a single opaque position here,
  // which is the conservative, honest default when we can't see inside.
  const named = lookThrough.filter((p) => p.value > 0 && !isUnattributedBucket(p.ticker));
  const shares = named.map((p) => p.value / total);
  const hhi = shares.reduce((sum, s) => sum + s * s, 0);
  const effectiveN = hhi > 0 ? 1 / hhi : 0;
  const base = Math.min(100, (effectiveN / DIVERSIFICATION_TARGET_EFFECTIVE_N) * 100);
  const topSharePct = shares.length > 0 ? Math.max(...shares) * 100 : 0;
  const penalty = Math.max(0, topSharePct - TOP_HOLDING_PENALTY_THRESHOLD) * TOP_HOLDING_PENALTY_RATE;
  const score = clamp(base - penalty, 0, 100);
  const sentence =
    `Your portfolio behaves like about ${effectiveN.toFixed(1)} equally-weighted holdings` +
    (topSharePct > TOP_HOLDING_PENALTY_THRESHOLD
      ? `, and your largest position is ${Math.round(topSharePct)}% of the portfolio.`
      : ".");
  return { key: "diversification", label: "Diversification", score, grade: gradeFor(score), sentence };
}

/** Concentration: how close the single biggest sector bet is to the
 *  user's configured "elevated"/"high" thresholds. Reuses `concentrationVerdict`
 *  for the sentence and the same 1.6x high-threshold ratio for scoring, so
 *  this always agrees with the dashboard's concentration banner. */
export function concentrationScore(slices: SectorSlice[], threshold: number): SubScore {
  const verdict = concentrationVerdict(slices, threshold);
  if (verdict.topSector === null) {
    return { key: "concentration", label: "Concentration", score: 100, grade: gradeFor(100), sentence: verdict.sentence };
  }
  const highThreshold = threshold * HIGH_THRESHOLD_MULTIPLIER;
  const pct = verdict.topPct;
  let score: number;
  if (pct <= threshold) {
    score = 100 - (pct / threshold) * 50; // 100 at 0%, 50 at the elevated threshold
  } else if (pct < highThreshold) {
    score = 50 - ((pct - threshold) / (highThreshold - threshold)) * 50; // 50 -> 0 across elevated..high
  } else {
    score = 0;
  }
  score = clamp(score, 0, 100);
  return { key: "concentration", label: "Concentration", score, grade: gradeFor(score), sentence: verdict.sentence };
}

// Perfect sector spread would land around this many effective sector
// buckets — there are ~11 real (non-broad-market) sectors in the ticker map.
const SECTOR_BALANCE_TARGET_EFFECTIVE_N = 8;

/** Sector balance: how evenly the portfolio's single-sector bets are spread,
 *  treating everything outside a real sector bet (broad-market funds, bonds,
 *  unmapped tickers) as one inherently-diversified bucket alongside them —
 *  so a mostly-broad-index portfolio with one modest sector tilt still
 *  scores well, consistent with how `concentration.ts` treats those sectors. */
export function sectorBalanceScore(slices: SectorSlice[]): SubScore {
  const sectorBets = slices.filter((s) => !NON_CONCENTRATION_SECTORS.has(s.sector));
  if (sectorBets.length === 0) {
    return {
      key: "sectorBalance",
      label: "Sector balance",
      score: 100,
      grade: gradeFor(100),
      sentence:
        slices.length === 0
          ? "Add holdings to see your sector balance."
          : "Your holdings are in broad-market or non-equity funds — no single-sector bets to balance.",
    };
  }
  const betFraction = sectorBets.reduce((sum, s) => sum + s.pct, 0) / 100;
  const safeFraction = 1 - betFraction;
  const shares = [...sectorBets.map((s) => s.pct / 100), ...(safeFraction > 1e-9 ? [safeFraction] : [])];
  const hhi = shares.reduce((sum, s) => sum + s * s, 0);
  const effectiveN = hhi > 0 ? 1 / hhi : 0;
  const score = clamp((effectiveN / SECTOR_BALANCE_TARGET_EFFECTIVE_N) * 100, 0, 100);
  const top = sectorBets[0];
  const sentence = `Your sector-specific bets are spread across ${sectorBets.length} sector${sectorBets.length > 1 ? "s" : ""}, led by ${top.sector} at ${Math.round(top.pct)}%.`;
  return { key: "sectorBalance", label: "Sector balance", score, grade: gradeFor(score), sentence };
}

// How hard an unharvested-loss dollar (weighted by potential tax savings, as
// a % of portfolio value) dents the score — tuned so a modest miss costs a
// few points rather than dominating the whole sub-score.
const UNHARVESTED_LOSS_PENALTY_MULTIPLIER = 4;

/**
 * Tax efficiency, computed entirely from *unrealized* positions (the `sales`
 * table has no acquisition date, so realized short/long-term can't be
 * reconstructed — see CLAUDE.md). Three components, equally weighted:
 *  A) share of unrealized taxable-account gains still short-term,
 *  B) unharvested taxable-account losses, weighted by the user's own
 *     short-term rate (a bigger potential saving is a bigger miss),
 *  C) fixed-income holdings sitting in taxable accounts instead of an IRA.
 */
export function taxEfficiencyScore(
  lots: Lot[],
  prices: Map<string, number>,
  accounts: Account[],
  profile: TaxProfile,
  today: string
): SubScore {
  if (lots.length === 0) {
    return {
      key: "taxEfficiency",
      label: "Tax efficiency",
      score: 0,
      grade: gradeFor(0),
      sentence: "Add holdings to see a tax-efficiency score.",
    };
  }

  const taxableLots = lots.filter((l) => !isIraAccount(accounts, l.accountId));
  const totalValue = lots.reduce((sum, l) => sum + l.shares * (prices.get(l.ticker) ?? l.costPerShare), 0);

  let shortTermGainValue = 0;
  let totalGainValue = 0;
  let unharvestedLossValue = 0;
  for (const l of taxableLots) {
    const price = prices.get(l.ticker) ?? l.costPerShare;
    const gainLoss = (price - l.costPerShare) * l.shares;
    if (gainLoss > 0) {
      totalGainValue += gainLoss;
      if (termFor(l.purchaseDate, today) === "short") shortTermGainValue += gainLoss;
    } else if (gainLoss < 0) {
      unharvestedLossValue += -gainLoss;
    }
  }
  const shortTermGainSharePct = totalGainValue > 0 ? (shortTermGainValue / totalGainValue) * 100 : 0;
  const scoreA = clamp(100 - shortTermGainSharePct, 0, 100);

  const potentialSavings = unharvestedLossValue * (shortTermRate(profile) / 100);
  const savingsPct = totalValue > 0 ? (potentialSavings / totalValue) * 100 : 0;
  const scoreB = clamp(100 - savingsPct * UNHARVESTED_LOSS_PENALTY_MULTIPLIER, 0, 100);

  let fixedIncomeTotal = 0;
  let fixedIncomeTaxable = 0;
  for (const l of lots) {
    if (sectorFor(l.ticker) !== "Fixed Income") continue;
    const value = l.shares * (prices.get(l.ticker) ?? l.costPerShare);
    fixedIncomeTotal += value;
    if (!isIraAccount(accounts, l.accountId)) fixedIncomeTaxable += value;
  }
  const scoreC = fixedIncomeTotal > 0 ? clamp(100 - (fixedIncomeTaxable / fixedIncomeTotal) * 100, 0, 100) : 100;

  const score = (scoreA + scoreB + scoreC) / 3;

  const sentenceParts: string[] = [];
  if (totalGainValue > 0 && shortTermGainSharePct > 0) {
    sentenceParts.push(`${Math.round(shortTermGainSharePct)}% of your unrealized gains are still short-term.`);
  }
  if (unharvestedLossValue > 1e-9) {
    sentenceParts.push(`You're sitting on $${unharvestedLossValue.toFixed(0)} of unharvested losses in taxable accounts.`);
  }
  if (fixedIncomeTotal > 0 && fixedIncomeTaxable > 0) {
    sentenceParts.push("Some fixed-income holdings sit in taxable accounts rather than tax-sheltered ones.");
  }
  const sentence = sentenceParts.length > 0 ? sentenceParts.join(" ") : "No obvious tax-efficiency issues in your current positions.";

  return { key: "taxEfficiency", label: "Tax efficiency", score, grade: gradeFor(score), sentence };
}

/** Cash allocation: a small buffer (2-10% of the portfolio) scores best;
 *  both zero cash and a large uninvested cash pile taper the score down. */
export function cashAllocationScore(cash: number, totalValue: number): SubScore {
  const total = totalValue + cash;
  if (total <= 0) {
    return {
      key: "cashAllocation",
      label: "Cash allocation",
      score: 0,
      grade: gradeFor(0),
      sentence: "Add holdings to see your cash allocation.",
    };
  }
  const pct = (cash / total) * 100;
  let score: number;
  if (pct >= 2 && pct <= 10) {
    score = 95;
  } else if (pct < 2) {
    score = 40 + (pct / 2) * 55; // 40 at 0% -> 95 at 2%
  } else if (pct <= 25) {
    score = 95 - ((pct - 10) / 15) * 65; // 95 at 10% -> 30 at 25%
  } else {
    score = Math.max(10, 30 - (pct - 25) * 1.5);
  }
  score = clamp(score, 0, 100);
  const sentence =
    pct < 2
      ? `Only ${pct.toFixed(1)}% of your portfolio is cash — little buffer for opportunities or emergencies.`
      : pct > 25
        ? `${Math.round(pct)}% of your portfolio is sitting in cash — that's a lot left out of the market.`
        : `${pct.toFixed(1)}% of your portfolio is cash — within a healthy range.`;
  return { key: "cashAllocation", label: "Cash allocation", score, grade: gradeFor(score), sentence };
}

/** Risk score, used both per-trade (Feature 1, before/after in
 *  `simulate.ts`) and as the 6th daily health sub-score (Feature 3, via
 *  `portfolioHealth` below): the larger of single-position or
 *  single-sector concentration risk, on the same "higher is healthier"
 *  0-100 scale as every other sub-score. Complements `diversificationScore`
 *  — a portfolio can be well-diversified by name count and still carry
 *  concentrated risk if one name or sector dominates the dollars. Note:
 *  this deliberately overlaps with `concentrationScore` (sector axis) and
 *  `diversificationScore` (position axis) — a concentrated portfolio is
 *  meant to be penalized on more than one axis, not double-counted by
 *  accident. `HEALTH_SCORE_WEIGHTS` reflects this on purpose; don't
 *  "fix" the overlap by removing risk from one or the other. */
export function riskScore(lookThrough: Position[], slices: SectorSlice[]): SubScore {
  const total = lookThrough.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  if (total <= 0) {
    return { key: "risk", label: "Risk", score: 0, grade: gradeFor(0), sentence: "Add holdings to see a risk score." };
  }
  const named = lookThrough.filter((p) => p.value > 0 && !isUnattributedBucket(p.ticker));
  const topPositionPct = named.length > 0 ? Math.max(...named.map((p) => (p.value / total) * 100)) : 0;
  const sectorBets = slices.filter((s) => !NON_CONCENTRATION_SECTORS.has(s.sector));
  const topSectorPct = sectorBets[0]?.pct ?? 0;

  const positionRisk = clamp(topPositionPct * 2, 0, 100); // 50% in one name -> max risk
  const sectorRisk = clamp(topSectorPct * 1.5, 0, 100); // ~67% in one sector -> max risk
  const riskLevel = Math.max(positionRisk, sectorRisk);
  const score = clamp(100 - riskLevel, 0, 100);
  const sentence =
    `Your largest single position is ${topPositionPct.toFixed(1)}% of your look-through portfolio` +
    (topSectorPct > 0 ? `, and your largest sector bet is ${Math.round(topSectorPct)}%.` : ".");
  return { key: "risk", label: "Risk", score, grade: gradeFor(score), sentence };
}

export const HEALTH_SCORE_WEIGHTS: Record<string, number> = {
  diversification: 20,
  concentration: 20,
  sectorBalance: 15,
  taxEfficiency: 20,
  cashAllocation: 10,
  risk: 15,
};

// Weights are expressed as whole numbers for readability (they happen to
// sum to 100 today), but `overall` is computed as a proper weighted mean —
// dividing by this computed total rather than a hardcoded 100 — so a future
// rebalance can't silently break the math the way a literal divisor would.
const HEALTH_WEIGHT_TOTAL = Object.values(HEALTH_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);

/** The daily Portfolio Health Score (Feature 3) — a weighted mean of the
 *  six sub-scores above, persisted once per day in `health_snapshots`. */
export function portfolioHealth(
  lookThrough: Position[],
  slices: SectorSlice[],
  threshold: number,
  lots: Lot[],
  prices: Map<string, number>,
  accounts: Account[],
  profile: TaxProfile,
  cash: number,
  totalValue: number,
  today: string
): HealthScore {
  const diversification = diversificationScore(lookThrough, lots);
  const concentration = concentrationScore(slices, threshold);
  const risk = riskScore(lookThrough, slices);
  const sectorBalance = sectorBalanceScore(slices);
  const taxEfficiency = taxEfficiencyScore(lots, prices, accounts, profile, today);
  const cashAllocation = cashAllocationScore(cash, totalValue);

  const subScores = [diversification, concentration, risk, sectorBalance, taxEfficiency, cashAllocation];
  const overall =
    subScores.reduce((sum, s) => sum + s.score * (HEALTH_SCORE_WEIGHTS[s.key] ?? 0), 0) /
    HEALTH_WEIGHT_TOTAL;

  return { overall, overallGrade: gradeFor(overall), subScores, computedAt: today };
}
