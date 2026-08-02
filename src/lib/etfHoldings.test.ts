import { describe, expect, it } from "vitest";
import { asOfFor, holdingsFor, knownEtfTickers, noteFor } from "@/lib/etfHoldings";

describe("holdingsFor", () => {
  it("returns holdings for a mapped, non-empty ETF", () => {
    const holdings = holdingsFor("QQQ");
    expect(holdings).not.toBeNull();
    expect(holdings!.length).toBeGreaterThan(0);
    expect(holdings!.some((h) => h.ticker === "AAPL")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(holdingsFor("qqq")).not.toBeNull();
  });

  it("returns an empty array (not null) for a tracked ETF with no overlap data", () => {
    expect(holdingsFor("GLD")).toEqual([]);
  });

  it("returns null for a ticker that isn't an ETF we track", () => {
    expect(holdingsFor("AAPL")).toBeNull();
    expect(holdingsFor("NOTAREALTICKER")).toBeNull();
  });
});

describe("noteFor / asOfFor", () => {
  it("has a note for empty-holdings funds explaining why", () => {
    expect(noteFor("GLD")).toContain("gold");
    expect(noteFor("AGG")).not.toBeNull();
  });

  it("has no note for a fund with real holdings data", () => {
    expect(noteFor("QQQ")).toBeNull();
  });

  it("has an asOf date for every known fund", () => {
    for (const ticker of knownEtfTickers()) {
      expect(asOfFor(ticker)).toMatch(/^\d{4}-\d{2}$/);
    }
  });
});

describe("knownEtfTickers", () => {
  it("covers all 24 ETFs flagged isEtf in the sector map", () => {
    expect(knownEtfTickers()).toHaveLength(24);
  });
});
