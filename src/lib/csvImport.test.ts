import { describe, expect, it } from "vitest";
import { parseHoldingsCsv, splitCsvLine } from "@/lib/csvImport";

describe("splitCsvLine", () => {
  it("handles quoted fields with commas and escaped quotes", () => {
    expect(splitCsvLine('AAPL,"Apple, Inc.","She said ""hi""",10')).toEqual([
      "AAPL",
      "Apple, Inc.",
      'She said "hi"',
      "10",
    ]);
  });
});

describe("parseHoldingsCsv", () => {
  it("parses a simple export", () => {
    const csv = [
      "Symbol,Quantity,Cost Per Share,Purchase Date",
      "AAPL,10,185.50,2025-11-10",
      "vti,2.5,220.00,05/20/2025",
    ].join("\n");
    const result = parseHoldingsCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.lots).toEqual([
      { ticker: "AAPL", shares: 10, costPerShare: 185.5, purchaseDate: "2025-11-10" },
      { ticker: "VTI", shares: 2.5, costPerShare: 220, purchaseDate: "2025-05-20" },
    ]);
  });

  it("derives per-share cost from a total cost basis column", () => {
    const csv = [
      "Symbol,Quantity,Cost Basis,Date Acquired",
      'MSFT,10,"$4,100.00",01/15/2026',
    ].join("\n");
    const result = parseHoldingsCsv(csv);
    expect(result.lots[0].costPerShare).toBe(410);
  });

  it("skips junk rows (cash, disclaimers) with per-line errors", () => {
    const csv = [
      "Symbol,Quantity,Cost Per Share,Purchase Date",
      "AAPL,10,185.50,2025-11-10",
      "Pending Activity,,,",
      "SPAXX**,100,1.00,2025-01-01",
      "NVDA,-5,450,2026-01-15",
    ].join("\n");
    const result = parseHoldingsCsv(csv);
    expect(result.lots).toHaveLength(1);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.map((e) => e.line)).toEqual([3, 4, 5]);
  });

  it("fails clearly when required columns are missing", () => {
    const result = parseHoldingsCsv("Foo,Bar\n1,2");
    expect(result.lots).toEqual([]);
    expect(result.errors[0].message).toContain("Couldn't find column");
  });
});
