import { describe, expect, it } from "vitest";
import { simulateTrade } from "@/lib/simulate";
import { makeLot, makeSale } from "@/lib/testFixtures";
import type { Account } from "@/lib/types";
import { DEFAULT_TAX_PROFILE, type TaxProfile } from "@/lib/taxRates";

const TODAY = "2026-07-03";

const ACCOUNTS: Account[] = [
  { id: 1, name: "Taxable Brokerage", type: "taxable", cashBalance: 0 },
  { id: 2, name: "Vanguard Roth", type: "roth", cashBalance: 0 },
];

describe("simulateTrade — buys", () => {
  it("shows the concentration move and a clean wash-sale verdict", () => {
    const lots = [
      makeLot({ ticker: "AAPL", shares: 10, costPerShare: 100 }),
      makeLot({ ticker: "JPM", shares: 10, costPerShare: 100 }),
    ];
    const outcome = simulateTrade(
      { side: "buy", ticker: "AAPL", shares: 10, pricePerShare: 100, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      TODAY
    );
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.result.verdictSentence).toBe(
      "This trade would push your Information Technology exposure from 50% to 67% and doesn't trigger a wash sale."
    );
    expect(outcome.result.severity).toBe("warning"); // 67% > 40% = high
  });

  it("severity is warning when the trade triggers a wash sale", () => {
    const outcome = simulateTrade(
      { side: "buy", ticker: "NVDA", shares: 1, pricePerShare: 150, accountId: 1 },
      [makeLot({ ticker: "JPM", shares: 100, costPerShare: 100 })],
      [makeSale({ ticker: "NVDA", saleDate: "2026-06-23" })],
      ACCOUNTS,
      TODAY
    );
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.result.washSale?.kind).toBe("buy-after-loss");
    expect(outcome.result.severity).toBe("warning");
    expect(outcome.result.verdictSentence).toContain("would trigger a wash sale");
  });

  it("notes permanent disallowance in the verdict when repurchasing in an IRA", () => {
    const outcome = simulateTrade(
      { side: "buy", ticker: "NVDA", shares: 1, pricePerShare: 150, accountId: 2 },
      [makeLot({ ticker: "JPM", shares: 100, costPerShare: 100 })],
      [makeSale({ ticker: "NVDA", saleDate: "2026-06-23", accountId: 1 })],
      ACCOUNTS,
      TODAY
    );
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.result.washSale?.isIraPermanent).toBe(true);
    expect(outcome.result.verdictSentence).toContain("PERMANENTLY disallowed");
  });

  it("severity is ok for a small diversifying buy", () => {
    const lots = [
      makeLot({ ticker: "AAPL", shares: 1, costPerShare: 100 }),
      makeLot({ ticker: "JPM", shares: 1, costPerShare: 100 }),
      makeLot({ ticker: "XOM", shares: 1, costPerShare: 100 }),
      makeLot({ ticker: "JNJ", shares: 1, costPerShare: 100 }),
      makeLot({ ticker: "CAT", shares: 1, costPerShare: 100 }),
    ];
    const outcome = simulateTrade(
      { side: "buy", ticker: "NEE", shares: 1, pricePerShare: 100, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      TODAY
    );
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.result.severity).toBe("ok");
  });
});

describe("simulateTrade — live prices", () => {
  it("values positions at the live price when one is known", () => {
    // 10 AAPL bought at $100 but now worth $300 each: tech should dominate.
    const lots = [
      makeLot({ ticker: "AAPL", shares: 10, costPerShare: 100 }),
      makeLot({ ticker: "JPM", shares: 10, costPerShare: 100 }),
    ];
    const prices = new Map([["AAPL", 300]]);
    const outcome = simulateTrade(
      { side: "buy", ticker: "JPM", shares: 1, pricePerShare: 100, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      TODAY,
      prices
    );
    if (!outcome.ok) throw new Error(outcome.error);
    // Before: AAPL 3000 vs JPM 1000 -> tech at 75%, not 50%.
    const tech = outcome.result.before.slices.find(
      (s) => s.sector === "Information Technology"
    )!;
    expect(tech.pct).toBe(75);
  });

  it("removes sold shares at the live price, not the cost basis", () => {
    const lots = [
      makeLot({ ticker: "AAPL", shares: 10, costPerShare: 100 }),
      makeLot({ ticker: "JPM", shares: 30, costPerShare: 100 }),
    ];
    const prices = new Map([
      ["AAPL", 300],
      ["JPM", 100],
    ]);
    const outcome = simulateTrade(
      { side: "sell", ticker: "AAPL", shares: 5, pricePerShare: 300, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      TODAY,
      prices
    );
    if (!outcome.ok) throw new Error(outcome.error);
    // After: AAPL 5 shares * $300 = 1500 vs JPM 3000 -> tech 33.3%.
    const tech = outcome.result.after.slices.find(
      (s) => s.sector === "Information Technology"
    )!;
    expect(tech.pct).toBeCloseTo(33.33, 1);
    // Realized gain still uses cost basis: (300 - 100) * 5.
    expect(outcome.result.sellPreview?.realizedGainLoss).toBe(1000);
  });
});

describe("simulateTrade — sells", () => {
  const lots = [
    makeLot({ ticker: "AAPL", shares: 100, costPerShare: 100, accountId: 1 }),
    makeLot({ ticker: "JPM", shares: 100, costPerShare: 100, accountId: 1 }),
  ];

  it("reduces the sector's allocation (regression: negative adjustments must net)", () => {
    const outcome = simulateTrade(
      { side: "sell", ticker: "AAPL", shares: 50, pricePerShare: 80, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      TODAY
    );
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.result.verdictSentence).toContain(
      "lower your Information Technology exposure from 50% to 33%"
    );
  });

  it("adds a future-rebuy note on a clean loss sell", () => {
    const outcome = simulateTrade(
      { side: "sell", ticker: "AAPL", shares: 50, pricePerShare: 80, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      TODAY
    );
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.result.washSale).toBeNull();
    expect(outcome.result.futureRebuyNote).toContain("2026-08-03");
  });

  it("omits the future-rebuy note on a gain sell", () => {
    const outcome = simulateTrade(
      { side: "sell", ticker: "AAPL", shares: 50, pricePerShare: 120, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      TODAY
    );
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.result.futureRebuyNote).toBeNull();
  });

  it("requires an account", () => {
    const outcome = simulateTrade(
      { side: "sell", ticker: "AAPL", shares: 10, pricePerShare: 80 },
      lots,
      [],
      ACCOUNTS,
      TODAY
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("account");
  });

  it("rejects selling a ticker not held in the account", () => {
    const outcome = simulateTrade(
      { side: "sell", ticker: "VTI", shares: 1, pricePerShare: 250, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      TODAY
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("don't hold any VTI");
  });

  it("rejects overselling", () => {
    const outcome = simulateTrade(
      { side: "sell", ticker: "AAPL", shares: 999, pricePerShare: 80, accountId: 1 },
      lots,
      [],
      ACCOUNTS,
      TODAY
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("only hold 100 shares");
  });
});

describe("simulateTrade — tax profile flows through to the tax check", () => {
  it("changes the estimated tax when a non-default profile is passed (regression: /api/simulate once silently ignored the user's tax profile)", () => {
    const lots = [
      makeLot({ ticker: "NVDA", shares: 10, costPerShare: 100, purchaseDate: "2026-06-01", accountId: 1 }),
    ];
    const trade = {
      side: "sell" as const,
      ticker: "NVDA",
      shares: 10,
      pricePerShare: 200,
      accountId: 1,
    };

    const defaultOutcome = simulateTrade(trade, lots, [], ACCOUNTS, TODAY, new Map(), 25, DEFAULT_TAX_PROFILE);
    const highIncomeProfile: TaxProfile = {
      filingStatus: "single",
      annualTaxableIncome: 600_000,
      stateTaxRate: 9,
    };
    const highIncomeOutcome = simulateTrade(trade, lots, [], ACCOUNTS, TODAY, new Map(), 25, highIncomeProfile);

    if (!defaultOutcome.ok || !highIncomeOutcome.ok) {
      throw new Error("expected both simulations to succeed");
    }
    const defaultTax = defaultOutcome.result.taxCheck?.estimatedTax.total ?? 0;
    const highIncomeTax = highIncomeOutcome.result.taxCheck?.estimatedTax.total ?? 0;
    expect(highIncomeTax).toBeGreaterThan(defaultTax);
  });
});
