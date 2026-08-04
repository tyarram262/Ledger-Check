import { describe, expect, it } from "vitest";
import { checkTax } from "@/lib/taxCheck";
import { makeLot } from "@/lib/testFixtures";
import type { Account } from "@/lib/types";
import type { TaxProfile } from "@/lib/taxRates";

const TODAY = "2026-07-03";

const ACCOUNTS: Account[] = [
  { id: 1, name: "Taxable Brokerage", type: "taxable", cashBalance: 0 },
  { id: 2, name: "Vanguard Roth", type: "roth", cashBalance: 0 },
  { id: 3, name: "Fidelity Traditional IRA", type: "traditional_ira", cashBalance: 0 },
];

// annualTaxableIncome=80,000 single -> 22% ordinary bracket, 15% LTCG bracket, no NIIT.
const PROFILE: TaxProfile = { filingStatus: "single", annualTaxableIncome: 80_000, stateTaxRate: 0 };

describe("checkTax — long-term gain", () => {
  it("classifies a lot held well over a year as long-term and taxes it at the LTCG rate", () => {
    const lots = [
      makeLot({ ticker: "KO", shares: 10, costPerShare: 100, purchaseDate: "2024-01-01", accountId: 1 }),
    ];
    const result = checkTax(
      { side: "sell", ticker: "KO", shares: 10, pricePerShare: 150, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      PROFILE,
      TODAY
    );
    expect(result.isIraAccount).toBe(false);
    expect(result.lotBreakdown).toHaveLength(1);
    expect(result.lotBreakdown[0].term).toBe("long");
    expect(result.longTermGainLoss).toBe(500);
    expect(result.shortTermGainLoss).toBe(0);
    expect(result.estimatedTax.longTermTax).toBeCloseTo(75, 5); // 500 * 15%
    expect(result.estimatedTax.shortTermTax).toBe(0);
    expect(result.shortTermWarning).toBeNull();
    expect(result.longTermCountdown).toBeNull();
  });
});

describe("checkTax — short-term gain", () => {
  it("warns and taxes at the ordinary rate, and surfaces a long-term countdown", () => {
    const lots = [
      makeLot({ ticker: "NVDA", shares: 5, costPerShare: 450, purchaseDate: "2026-04-15", accountId: 1 }),
    ];
    const result = checkTax(
      { side: "sell", ticker: "NVDA", shares: 5, pricePerShare: 500, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      PROFILE,
      TODAY
    );
    expect(result.shortTermGainLoss).toBe(250);
    expect(result.estimatedTax.shortTermTax).toBeCloseTo(55, 5); // 250 * 22%
    expect(result.shortTermWarning).toContain("$250.00");
    expect(result.shortTermWarning).toContain("22.0%");

    expect(result.longTermCountdown).not.toBeNull();
    expect(result.longTermCountdown?.shares).toBe(5);
    expect(result.longTermCountdown?.date).toBe("2027-04-16");
    expect(result.longTermCountdown?.taxSaved).toBeCloseTo(250 * 0.07, 5); // 250 * (22% - 15%)
  });

  it("does not fire the countdown when the sale is a loss", () => {
    const lots = [
      makeLot({ ticker: "NVDA", shares: 5, costPerShare: 500, purchaseDate: "2026-04-15", accountId: 1 }),
    ];
    const result = checkTax(
      { side: "sell", ticker: "NVDA", shares: 5, pricePerShare: 450, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      PROFILE,
      TODAY
    );
    expect(result.shortTermGainLoss).toBe(-250);
    expect(result.estimatedTax.shortTermTax).toBe(0);
    expect(result.shortTermWarning).toBeNull();
    expect(result.longTermCountdown).toBeNull();
  });

  it("does not fire the countdown for a lot that's already long-term", () => {
    const lots = [
      makeLot({ ticker: "KO", shares: 5, costPerShare: 50, purchaseDate: "2023-01-01", accountId: 1 }),
    ];
    const result = checkTax(
      { side: "sell", ticker: "KO", shares: 5, pricePerShare: 90, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      PROFILE,
      TODAY
    );
    expect(result.longTermCountdown).toBeNull();
  });
});

describe("checkTax — mixed short and long lots in one FIFO sell", () => {
  it("splits the gain across both terms correctly", () => {
    const lots = [
      makeLot({ ticker: "MSFT", shares: 5, costPerShare: 100, purchaseDate: "2024-01-01", accountId: 1 }), // long
      makeLot({ ticker: "MSFT", shares: 5, costPerShare: 300, purchaseDate: "2026-06-01", accountId: 1 }), // short
    ];
    const result = checkTax(
      { side: "sell", ticker: "MSFT", shares: 10, pricePerShare: 350, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      PROFILE,
      TODAY
    );
    expect(result.lotBreakdown).toHaveLength(2);
    expect(result.longTermGainLoss).toBe((350 - 100) * 5); // 1250
    expect(result.shortTermGainLoss).toBe((350 - 300) * 5); // 250
    expect(result.estimatedTax.total).toBeCloseTo(1250 * 0.15 + 250 * 0.22, 5);
  });
});

describe("checkTax — IRA accounts", () => {
  it("zeroes every tax figure for a Roth sell instead of computing a real rate", () => {
    const lots = [
      makeLot({ ticker: "AMZN", shares: 5, costPerShare: 100, purchaseDate: "2026-04-15", accountId: 2, accountName: "Vanguard Roth" }),
    ];
    const result = checkTax(
      { side: "sell", ticker: "AMZN", shares: 5, pricePerShare: 200, accountId: 2 },
      lots,
      [],
      ACCOUNTS,
      PROFILE,
      TODAY
    );
    expect(result.isIraAccount).toBe(true);
    expect(result.estimatedTax.shortTermTax).toBe(0);
    expect(result.estimatedTax.longTermTax).toBe(0);
    expect(result.estimatedTax.total).toBe(0);
    expect(result.shortTermWarning).toBeNull();
    expect(result.longTermCountdown).toBeNull();
    // The gain/loss figures themselves are still informative even though untaxed.
    expect(result.shortTermGainLoss).toBe(500);
  });
});

describe("checkTax — wash-sale integration", () => {
  it("still surfaces the wash-sale warning from checkWashSale on a loss sell", () => {
    const lots = [
      makeLot({ ticker: "JNJ", shares: 10, costPerShare: 220, purchaseDate: "2026-06-20", accountId: 1 }),
    ];
    const result = checkTax(
      { side: "sell", ticker: "JNJ", shares: 5, pricePerShare: 200, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      PROFILE,
      TODAY
    );
    expect(result.washSale?.kind).toBe("sell-with-recent-buy");
    expect(result.estimatedTax.total).toBe(0); // it's a loss, nothing owed
  });

  it("passes through a null washSale when nothing triggers", () => {
    const lots = [
      makeLot({ ticker: "JNJ", shares: 10, costPerShare: 100, purchaseDate: "2024-01-01", accountId: 1 }),
    ];
    const result = checkTax(
      { side: "sell", ticker: "JNJ", shares: 5, pricePerShare: 150, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      PROFILE,
      TODAY
    );
    expect(result.washSale).toBeNull();
  });
});

describe("checkTax — lots with no known purchase date", () => {
  it("excludes an unknown-term lot from short/long gain totals and the tax estimate, and warns instead of guessing", () => {
    const lots = [
      makeLot({ ticker: "IBM", shares: 10, costPerShare: 100, purchaseDate: null, accountId: 1 }),
    ];
    const result = checkTax(
      { side: "sell", ticker: "IBM", shares: 10, pricePerShare: 150, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      PROFILE,
      TODAY
    );
    expect(result.lotBreakdown[0].term).toBe("unknown");
    expect(result.lotBreakdown[0].longTermOn).toBeNull();
    expect(result.lotBreakdown[0].daysUntilLongTerm).toBeNull();
    expect(result.shortTermGainLoss).toBe(0);
    expect(result.longTermGainLoss).toBe(0);
    expect(result.unknownTermGainLoss).toBe(500);
    expect(result.estimatedTax.total).toBe(0);
    expect(result.unknownTermWarning).toContain("10 shares");
  });

  it("only excludes the unknown-date portion when a sell spans both a dated and an undated lot", () => {
    const lots = [
      makeLot({ ticker: "IBM", shares: 5, costPerShare: 100, purchaseDate: "2024-01-01", accountId: 1 }), // dated, long-term
      makeLot({ ticker: "IBM", shares: 5, costPerShare: 100, purchaseDate: null, accountId: 1 }), // undated, sorts last (FIFO)
    ];
    const result = checkTax(
      { side: "sell", ticker: "IBM", shares: 10, pricePerShare: 150, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      PROFILE,
      TODAY
    );
    expect(result.longTermGainLoss).toBe((150 - 100) * 5); // only the dated lot
    expect(result.unknownTermGainLoss).toBe((150 - 100) * 5); // only the undated lot
    expect(result.estimatedTax.total).toBeCloseTo(250 * 0.15, 5); // dated portion only
    expect(result.unknownTermWarning).toContain("some");
  });

  it("has no unknownTermWarning when every lot has a known date", () => {
    const lots = [
      makeLot({ ticker: "KO", shares: 10, costPerShare: 100, purchaseDate: "2024-01-01", accountId: 1 }),
    ];
    const result = checkTax(
      { side: "sell", ticker: "KO", shares: 10, pricePerShare: 150, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      PROFILE,
      TODAY
    );
    expect(result.unknownTermWarning).toBeNull();
  });
});
