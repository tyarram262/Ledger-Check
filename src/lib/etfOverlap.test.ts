import { describe, expect, it } from "vitest";
import { computeOverlap, lookThroughPositions } from "@/lib/etfOverlap";
import type { Position } from "@/lib/concentration";

describe("lookThroughPositions", () => {
  it("conserves total portfolio value", () => {
    const positions: Position[] = [
      { ticker: "AAPL", value: 10_000 },
      { ticker: "QQQ", value: 20_000 },
      { ticker: "GLD", value: 5_000 },
    ];
    const total = positions.reduce((s, p) => s + p.value, 0);
    const lookThrough = lookThroughPositions(positions);
    const expandedTotal = lookThrough.reduce((s, p) => s + p.value, 0);
    expect(expandedTotal).toBeCloseTo(total, 5);
  });

  it("leaves a plain stock position untouched", () => {
    const lookThrough = lookThroughPositions([{ ticker: "AAPL", value: 10_000 }]);
    expect(lookThrough).toEqual([{ ticker: "AAPL", value: 10_000 }]);
  });

  it("leaves an ETF with no holdings data as its own bucket (not dissolved)", () => {
    const lookThrough = lookThroughPositions([{ ticker: "GLD", value: 5_000 }]);
    expect(lookThrough).toEqual([{ ticker: "GLD", value: 5_000 }]);
  });

  it("splits a mapped ETF into constituents plus an unattributed residual", () => {
    const lookThrough = lookThroughPositions([{ ticker: "QQQ", value: 10_000 }]);
    const aapl = lookThrough.find((p) => p.ticker === "AAPL");
    const residual = lookThrough.find((p) => p.ticker === "QQQ:UNATTRIBUTED");
    expect(aapl).toBeDefined();
    expect(aapl!.value).toBeCloseTo(10_000 * 0.089, 2); // QQQ's AAPL weight is 8.9%
    expect(residual).toBeDefined();
    expect(residual!.value).toBeGreaterThan(0); // top holdings don't sum to 100%
  });

  it("combines direct and indirect holdings of the same ticker into one bucket", () => {
    const lookThrough = lookThroughPositions([
      { ticker: "AAPL", value: 10_000 },
      { ticker: "QQQ", value: 10_000 },
    ]);
    const aaplEntries = lookThrough.filter((p) => p.ticker === "AAPL");
    expect(aaplEntries).toHaveLength(1);
    expect(aaplEntries[0].value).toBeCloseTo(10_000 + 10_000 * 0.089, 2);
  });
});

describe("computeOverlap — individual stock trade", () => {
  const before: Position[] = [
    { ticker: "QQQ", value: 50_000 },
    { ticker: "MSFT", value: 5_000 },
  ];

  it("finds AAPL exposure through QQQ even though AAPL isn't held directly", () => {
    const after = [...before, { ticker: "AAPL", value: 5_000 }];
    const result = computeOverlap("AAPL", before, after);

    expect(result.contributors).toHaveLength(1);
    expect(result.contributors[0].viaEtf).toBe("QQQ");
    expect(result.contributors[0].dollarValue).toBeCloseTo(50_000 * 0.089, 2);
    expect(result.trueExposureBefore).toBeGreaterThan(0);
    expect(result.trueExposureAfter).toBeGreaterThan(result.trueExposureBefore);
    expect(result.sentence).toContain("QQQ");
  });

  it("reports zero exposure and no contributors for a ticker held nowhere", () => {
    const after = [...before, { ticker: "XOM", value: 1_000 }];
    const result = computeOverlap("XOM", before, after);
    expect(result.trueExposureBefore).toBe(0);
    expect(result.contributors).toHaveLength(0);
  });
});

describe("computeOverlap — unmapped ETFs", () => {
  it("flags a held ETF with no overlap data", () => {
    const before: Position[] = [{ ticker: "GLD", value: 10_000 }];
    const after = [...before, { ticker: "AAPL", value: 1_000 }];
    const result = computeOverlap("AAPL", before, after);
    expect(result.unmappedEtfs).toContain("GLD");
  });

  it("does not flag ETFs with real holdings data", () => {
    const before: Position[] = [{ ticker: "QQQ", value: 10_000 }];
    const after = [...before, { ticker: "AAPL", value: 1_000 }];
    const result = computeOverlap("AAPL", before, after);
    expect(result.unmappedEtfs).not.toContain("QQQ");
  });
});

describe("computeOverlap — ETF vs. ETF overlap", () => {
  it("flags substantial overlap between two near-duplicate S&P 500 funds", () => {
    const before: Position[] = [{ ticker: "SPY", value: 50_000 }];
    const after = [...before, { ticker: "VOO", value: 10_000 }];
    const result = computeOverlap("VOO", before, after);
    expect(result.etfOverlaps.length).toBeGreaterThan(0);
    expect(result.etfOverlaps[0].ticker).toBe("SPY");
    expect(result.etfOverlaps[0].sharedWeightPct).toBeGreaterThan(30);
    expect(result.sentence).toContain("SPY");
  });

  it("does not flag overlap between dissimilar sector funds", () => {
    const before: Position[] = [{ ticker: "XLE", value: 20_000 }];
    const after = [...before, { ticker: "XLV", value: 10_000 }];
    const result = computeOverlap("XLV", before, after);
    expect(result.etfOverlaps).toHaveLength(0);
  });

  it("uses direct-only exposure for a traded ETF ticker (no look-through dissolving itself)", () => {
    const before: Position[] = [{ ticker: "QQQ", value: 50_000 }, { ticker: "MSFT", value: 5_000 }];
    const after = [...before, { ticker: "QQQ", value: 10_000 }];
    const result = computeOverlap("QQQ", before, after);
    expect(result.trueExposureBefore).toBeCloseTo((50_000 / 55_000) * 100, 5);
  });
});
