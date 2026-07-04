import { describe, expect, it } from "vitest";
import {
  concentrationVerdict,
  sectorAllocation,
} from "@/lib/concentration";

describe("sectorAllocation", () => {
  it("groups by sector and computes percentages", () => {
    const slices = sectorAllocation([
      { ticker: "AAPL", value: 5000 }, // Information Technology
      { ticker: "MSFT", value: 5000 }, // Information Technology
      { ticker: "JPM", value: 10000 }, // Financials
    ]);
    expect(slices).toHaveLength(2);
    expect(slices[0].pct).toBe(50);
    expect(slices[1].pct).toBe(50);
  });

  it("nets negative adjustments (sells) against the sector total", () => {
    const slices = sectorAllocation([
      { ticker: "AAPL", value: 10000 },
      { ticker: "JPM", value: 10000 },
      { ticker: "AAPL", value: -5000 }, // simulated sell
    ]);
    const tech = slices.find((s) => s.sector === "Information Technology")!;
    expect(tech.value).toBe(5000);
    expect(tech.pct).toBeCloseTo(33.33, 1);
  });

  it("drops sectors that net to zero", () => {
    const slices = sectorAllocation([
      { ticker: "AAPL", value: 5000 },
      { ticker: "AAPL", value: -5000 },
      { ticker: "JPM", value: 1000 },
    ]);
    expect(slices).toHaveLength(1);
    expect(slices[0].sector).toBe("Financials");
  });

  it("buckets unknown tickers as Unmapped", () => {
    const slices = sectorAllocation([{ ticker: "ZZZZ", value: 100 }]);
    expect(slices[0].sector).toBe("Unmapped");
  });
});

describe("concentrationVerdict", () => {
  it("says high above 40%", () => {
    const verdict = concentrationVerdict(
      sectorAllocation([
        { ticker: "AAPL", value: 41 },
        { ticker: "JPM", value: 59 },
      ])
    );
    expect(verdict.level).toBe("high");
    expect(verdict.sentence).toContain("high concentration");
  });

  it("says elevated above 25%", () => {
    const verdict = concentrationVerdict(
      sectorAllocation([
        { ticker: "AAPL", value: 26 },
        { ticker: "JPM", value: 20 },
        { ticker: "XOM", value: 20 },
        { ticker: "JNJ", value: 20 },
        { ticker: "CAT", value: 14 },
      ])
    );
    expect(verdict.level).toBe("elevated");
  });

  it("treats exactly 25% as diversified (thresholds are strict)", () => {
    const verdict = concentrationVerdict(
      sectorAllocation([
        { ticker: "AAPL", value: 25 },
        { ticker: "JPM", value: 25 },
        { ticker: "XOM", value: 25 },
        { ticker: "JNJ", value: 25 },
      ])
    );
    expect(verdict.level).toBe("diversified");
  });

  it("does not treat a broad-market-only portfolio as concentrated", () => {
    const verdict = concentrationVerdict(
      sectorAllocation([{ ticker: "VTI", value: 100000 }])
    );
    expect(verdict.level).toBe("diversified");
    expect(verdict.topSector).toBeNull();
  });

  it("judges the single-sector bet even when broad funds dominate", () => {
    // 80% VTI, 20% AAPL: the sector bet to judge is tech at 20% of total.
    const verdict = concentrationVerdict(
      sectorAllocation([
        { ticker: "VTI", value: 80 },
        { ticker: "AAPL", value: 20 },
      ])
    );
    expect(verdict.topSector).toBe("Information Technology");
    expect(verdict.level).toBe("diversified");
  });

  it("handles an empty portfolio", () => {
    const verdict = concentrationVerdict(sectorAllocation([]));
    expect(verdict.level).toBe("diversified");
    expect(verdict.sentence).toContain("Add holdings");
  });
});
