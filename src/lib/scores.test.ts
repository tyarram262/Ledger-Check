import { describe, expect, it } from "vitest";
import {
  cashAllocationScore,
  concentrationScore,
  diversificationScore,
  gradeFor,
  HEALTH_SCORE_WEIGHTS,
  portfolioHealth,
  riskScore,
  sectorBalanceScore,
  taxEfficiencyScore,
} from "@/lib/scores";
import { sectorAllocation, type Position } from "@/lib/concentration";
import { lookThroughPositions } from "@/lib/etfOverlap";
import { makeLot } from "@/lib/testFixtures";
import type { Account, Lot } from "@/lib/types";
import { DEFAULT_TAX_PROFILE, type TaxProfile } from "@/lib/taxRates";

const TODAY = "2026-07-03";
const ACCOUNTS: Account[] = [
  { id: 1, name: "Taxable Brokerage", type: "taxable", cashBalance: 0 },
  { id: 2, name: "Vanguard Roth", type: "roth", cashBalance: 0 },
];

describe("gradeFor", () => {
  it("maps score boundaries to the right letter grade", () => {
    expect(gradeFor(100)).toBe("A");
    expect(gradeFor(93)).toBe("A");
    expect(gradeFor(92.9)).toBe("A-");
    expect(gradeFor(90)).toBe("A-");
    expect(gradeFor(89.9)).toBe("B+");
    expect(gradeFor(60)).toBe("D");
    expect(gradeFor(59.9)).toBe("F");
    expect(gradeFor(0)).toBe("F");
  });
});

describe("diversificationScore", () => {
  it("scores an empty portfolio as 0", () => {
    const result = diversificationScore([], []);
    expect(result.score).toBe(0);
  });

  it("scores a single-stock portfolio poorly", () => {
    const lots = [makeLot({ ticker: "AAPL", shares: 10, costPerShare: 100 })];
    const positions: Position[] = [{ ticker: "AAPL", value: 1_000 }];
    const result = diversificationScore(lookThroughPositions(positions), lots);
    expect(result.score).toBe(0);
    expect(result.grade).toBe("F");
  });

  it("scores a broad-index fund very well via look-through, even though it's one ticker", () => {
    const lots = [makeLot({ ticker: "VOO", shares: 10, costPerShare: 400 })];
    const positions: Position[] = [{ ticker: "VOO", value: 100_000 }];
    const result = diversificationScore(lookThroughPositions(positions), lots);
    expect(result.score).toBeGreaterThan(90);
    expect(result.grade).toBe("A");
  });

  it("scores 10 equally-weighted individual stocks reasonably well", () => {
    const tickers = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "JPM", "XOM", "JNJ", "KO"];
    const lots = tickers.map((t) => makeLot({ ticker: t }));
    const positions: Position[] = tickers.map((t) => ({ ticker: t, value: 10_000 }));
    const result = diversificationScore(lookThroughPositions(positions), lots);
    expect(result.score).toBeGreaterThan(70);
  });
});

describe("concentrationScore", () => {
  it("scores 100 when there's no single-sector bet", () => {
    const positions: Position[] = [{ ticker: "VOO", value: 10_000 }];
    const slices = sectorAllocation(positions);
    const result = concentrationScore(slices, 25);
    expect(result.score).toBe(100);
  });

  it("scores 50 exactly at the elevated threshold", () => {
    // AAPL (Information Technology) is the only single-sector bet, at
    // exactly 25%; the rest is VOO, which is excluded as broad-market.
    const positions: Position[] = [
      { ticker: "AAPL", value: 25_000 },
      { ticker: "VOO", value: 75_000 },
    ];
    const slices = sectorAllocation(positions);
    const result = concentrationScore(slices, 25);
    expect(result.score).toBeCloseTo(50, 5);
  });

  it("scores 0 at or above the high threshold (1.6x elevated)", () => {
    const positions: Position[] = [{ ticker: "AAPL", value: 100_000 }];
    const slices = sectorAllocation(positions);
    const result = concentrationScore(slices, 25); // high threshold = 40%, AAPL is 100%
    expect(result.score).toBe(0);
    expect(result.grade).toBe("F");
  });
});

describe("sectorBalanceScore", () => {
  it("scores 100 when everything is broad-market", () => {
    const positions: Position[] = [{ ticker: "VOO", value: 10_000 }];
    const result = sectorBalanceScore(sectorAllocation(positions));
    expect(result.score).toBe(100);
  });

  it("scores a single 100% sector bet poorly", () => {
    const positions: Position[] = [{ ticker: "AAPL", value: 10_000 }];
    const result = sectorBalanceScore(sectorAllocation(positions));
    expect(result.score).toBeLessThan(30);
  });

  it("scores several evenly-spread sector bets better than one concentrated bet", () => {
    const spread: Position[] = [
      { ticker: "AAPL", value: 10_000 }, // Information Technology
      { ticker: "JPM", value: 10_000 }, // Financials
      { ticker: "JNJ", value: 10_000 }, // Health Care
      { ticker: "XOM", value: 10_000 }, // Energy
    ];
    const concentrated: Position[] = [{ ticker: "AAPL", value: 40_000 }];
    const spreadScore = sectorBalanceScore(sectorAllocation(spread)).score;
    const concentratedScore = sectorBalanceScore(sectorAllocation(concentrated)).score;
    expect(spreadScore).toBeGreaterThan(concentratedScore);
  });
});

describe("taxEfficiencyScore", () => {
  it("scores an empty portfolio as 0", () => {
    expect(taxEfficiencyScore([], new Map(), ACCOUNTS, DEFAULT_TAX_PROFILE, TODAY).score).toBe(0);
  });

  it("scores well when gains are long-term and there's nothing to harvest", () => {
    const lots: Lot[] = [makeLot({ ticker: "KO", shares: 10, costPerShare: 50, purchaseDate: "2023-01-01", accountId: 1 })];
    const prices = new Map([["KO", 90]]);
    const result = taxEfficiencyScore(lots, prices, ACCOUNTS, DEFAULT_TAX_PROFILE, TODAY);
    expect(result.score).toBe(100);
  });

  it("penalizes a portfolio sitting entirely in short-term gains", () => {
    const lots: Lot[] = [makeLot({ ticker: "KO", shares: 10, costPerShare: 50, purchaseDate: "2026-06-01", accountId: 1 })];
    const prices = new Map([["KO", 90]]);
    const result = taxEfficiencyScore(lots, prices, ACCOUNTS, DEFAULT_TAX_PROFILE, TODAY);
    expect(result.score).toBeLessThan(100);
    expect(result.sentence).toContain("short-term");
  });

  it("penalizes unharvested losses proportionally to the user's tax rate", () => {
    const lots: Lot[] = [makeLot({ ticker: "KO", shares: 100, costPerShare: 90, purchaseDate: "2023-01-01", accountId: 1 })];
    const prices = new Map([["KO", 50]]); // big unrealized loss
    const lowRateProfile: TaxProfile = { filingStatus: "single", annualTaxableIncome: 0, stateTaxRate: 0 };
    const highRateProfile: TaxProfile = { filingStatus: "single", annualTaxableIncome: 700_000, stateTaxRate: 10 };
    const low = taxEfficiencyScore(lots, prices, ACCOUNTS, lowRateProfile, TODAY).score;
    const high = taxEfficiencyScore(lots, prices, ACCOUNTS, highRateProfile, TODAY).score;
    expect(high).toBeLessThan(low);
  });

  it("does not penalize gains/losses sitting inside an IRA", () => {
    const lots: Lot[] = [
      makeLot({ ticker: "KO", shares: 10, costPerShare: 90, purchaseDate: "2026-06-01", accountId: 2, accountName: "Vanguard Roth" }),
    ];
    const prices = new Map([["KO", 50]]); // loss, but it's inside an IRA
    const result = taxEfficiencyScore(lots, prices, ACCOUNTS, DEFAULT_TAX_PROFILE, TODAY);
    expect(result.score).toBe(100);
  });

  it("excludes a gain on a null-purchase-date lot from the score and mentions it in the sentence, rather than guessing its term", () => {
    const lots: Lot[] = [makeLot({ ticker: "KO", shares: 10, costPerShare: 50, purchaseDate: null, accountId: 1 })];
    const prices = new Map([["KO", 90]]);
    const result = taxEfficiencyScore(lots, prices, ACCOUNTS, DEFAULT_TAX_PROFILE, TODAY);
    // No classifiable gains and nothing to harvest -> component A and B are
    // both perfect; the unknown-dated gain isn't held against the score.
    expect(result.score).toBe(100);
    expect(result.sentence).toContain("no known purchase date");
  });
});

describe("cashAllocationScore", () => {
  it("scores 0 for a portfolio with no value at all", () => {
    expect(cashAllocationScore(0, 0).score).toBe(0);
  });

  it("scores the 2-10% band highest", () => {
    expect(cashAllocationScore(5_000, 95_000).score).toBe(95);
    expect(cashAllocationScore(10_000, 90_000).score).toBe(95);
  });

  it("tapers down for zero cash", () => {
    const score = cashAllocationScore(0, 100_000).score;
    expect(score).toBeLessThan(95);
    expect(score).toBeGreaterThan(0);
  });

  it("tapers down for a large cash pile", () => {
    const at25 = cashAllocationScore(25_000, 75_000).score;
    const at40 = cashAllocationScore(40_000, 60_000).score;
    expect(at40).toBeLessThan(at25);
  });
});

describe("riskScore", () => {
  it("scores an empty portfolio as 0", () => {
    expect(riskScore([], []).score).toBe(0);
  });

  it("scores a single concentrated stock position as high risk (low score)", () => {
    const positions: Position[] = [{ ticker: "AAPL", value: 100_000 }];
    const result = riskScore(lookThroughPositions(positions), sectorAllocation(positions));
    expect(result.score).toBe(0);
  });

  it("scores a broad-index position as low risk (high score)", () => {
    const positions: Position[] = [{ ticker: "VOO", value: 100_000 }];
    const result = riskScore(lookThroughPositions(positions), sectorAllocation(positions));
    expect(result.score).toBeGreaterThan(70);
  });
});

describe("portfolioHealth", () => {
  it("computes the overall score as the documented weighted mean of the six sub-scores", () => {
    const lots: Lot[] = [
      makeLot({ ticker: "VOO", shares: 100, costPerShare: 400, purchaseDate: "2023-01-01", accountId: 1 }),
      makeLot({ ticker: "AAPL", shares: 10, costPerShare: 150, purchaseDate: "2026-06-01", accountId: 1 }),
    ];
    const prices = new Map([
      ["VOO", 500],
      ["AAPL", 200],
    ]);
    const positions: Position[] = [
      { ticker: "VOO", value: 100 * 500 },
      { ticker: "AAPL", value: 10 * 200 },
    ];
    const health = portfolioHealth(
      lookThroughPositions(positions),
      sectorAllocation(positions),
      25,
      lots,
      prices,
      ACCOUNTS,
      DEFAULT_TAX_PROFILE,
      2_000,
      52_000,
      TODAY
    );

    expect(health.subScores).toHaveLength(6);
    const byKey = Object.fromEntries(health.subScores.map((s) => [s.key, s.score]));
    const weightTotal = Object.values(HEALTH_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    const expectedOverall =
      (byKey.diversification * HEALTH_SCORE_WEIGHTS.diversification +
        byKey.concentration * HEALTH_SCORE_WEIGHTS.concentration +
        byKey.risk * HEALTH_SCORE_WEIGHTS.risk +
        byKey.sectorBalance * HEALTH_SCORE_WEIGHTS.sectorBalance +
        byKey.taxEfficiency * HEALTH_SCORE_WEIGHTS.taxEfficiency +
        byKey.cashAllocation * HEALTH_SCORE_WEIGHTS.cashAllocation) /
      weightTotal;
    expect(health.overall).toBeCloseTo(expectedOverall, 5);
    expect(health.overallGrade).toBe(gradeFor(health.overall));
  });

  it("weights sum to 100 (a readability convention, not a correctness dependency — `overall` divides by the computed total)", () => {
    const total = Object.values(HEALTH_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });
});
