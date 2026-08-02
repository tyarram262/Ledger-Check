import { describe, expect, it } from "vitest";
import { checkWashSale, previewFifoSell } from "@/lib/washSale";
import { makeLot, makeSale } from "@/lib/testFixtures";
import type { Account } from "@/lib/types";

const TODAY = "2026-07-03";

const ACCOUNTS: Account[] = [
  { id: 1, name: "Taxable Brokerage", type: "taxable", cashBalance: 0 },
  { id: 2, name: "Vanguard Roth", type: "roth", cashBalance: 0 },
  { id: 3, name: "Fidelity Traditional IRA", type: "traditional_ira", cashBalance: 0 },
];

describe("checkWashSale — buy side", () => {
  it("flags a buy when the ticker was sold at a loss within 30 days", () => {
    const sales = [makeSale({ ticker: "NVDA", saleDate: "2026-06-23" })];
    const warning = checkWashSale(
      { side: "buy", ticker: "NVDA", shares: 10, pricePerShare: 150, accountId: 1 },
      sales,
      [],
      ACCOUNTS,
      TODAY
    );
    expect(warning?.kind).toBe("buy-after-loss");
    expect(warning?.windowClearsOn).toBe("2026-07-24");
    expect(warning?.isIraPermanent).toBe(false);
  });

  it("flags on the 30th day but not the 31st", () => {
    const at30 = checkWashSale(
      { side: "buy", ticker: "NVDA", shares: 1, pricePerShare: 1, accountId: 1 },
      [makeSale({ ticker: "NVDA", saleDate: "2026-06-03" })],
      [],
      ACCOUNTS,
      TODAY
    );
    const at31 = checkWashSale(
      { side: "buy", ticker: "NVDA", shares: 1, pricePerShare: 1, accountId: 1 },
      [makeSale({ ticker: "NVDA", saleDate: "2026-06-02" })],
      [],
      ACCOUNTS,
      TODAY
    );
    expect(at30).not.toBeNull();
    expect(at31).toBeNull();
  });

  it("ignores sales at a gain", () => {
    const sales = [
      makeSale({
        ticker: "NVDA",
        saleDate: "2026-06-23",
        salePricePerShare: 200,
        costPerShare: 100,
      }),
    ];
    expect(
      checkWashSale(
        { side: "buy", ticker: "NVDA", shares: 1, pricePerShare: 1, accountId: 1 },
        sales,
        [],
        ACCOUNTS,
        TODAY
      )
    ).toBeNull();
  });

  it("ignores other tickers", () => {
    const sales = [makeSale({ ticker: "AMD", saleDate: "2026-06-23" })];
    expect(
      checkWashSale(
        { side: "buy", ticker: "NVDA", shares: 1, pricePerShare: 1, accountId: 1 },
        sales,
        [],
        ACCOUNTS,
        TODAY
      )
    ).toBeNull();
  });

  it("catches cross-account wash sales (loss in IRA, buy in taxable)", () => {
    const sales = [
      makeSale({
        ticker: "NVDA",
        saleDate: "2026-06-23",
        accountId: 2,
        accountName: "Vanguard Roth",
      }),
    ];
    const warning = checkWashSale(
      { side: "buy", ticker: "NVDA", shares: 1, pricePerShare: 1, accountId: 1 },
      sales,
      [],
      ACCOUNTS,
      TODAY
    );
    expect(warning).not.toBeNull();
    expect(warning?.triggers[0].accountName).toBe("Vanguard Roth");
    // Loss originated in the IRA, but the replacement buy is in a taxable
    // account — normal deferral, not permanent disallowance.
    expect(warning?.isIraPermanent).toBe(false);
  });

  it("marks the loss as permanently disallowed when the repurchase is in an IRA", () => {
    const sales = [makeSale({ ticker: "NVDA", saleDate: "2026-06-23", accountId: 1 })];
    const warning = checkWashSale(
      { side: "buy", ticker: "NVDA", shares: 1, pricePerShare: 1, accountId: 3 },
      sales,
      [],
      ACCOUNTS,
      TODAY
    );
    expect(warning?.isIraPermanent).toBe(true);
    expect(warning?.message).toContain("PERMANENTLY disallowed");
  });

  it("matches tickers case-insensitively", () => {
    const sales = [makeSale({ ticker: "NVDA", saleDate: "2026-06-23" })];
    expect(
      checkWashSale(
        { side: "buy", ticker: "nvda", shares: 1, pricePerShare: 1, accountId: 1 },
        sales,
        [],
        ACCOUNTS,
        TODAY
      )
    ).not.toBeNull();
  });

  it("uses the latest loss sale for the clear date when there are several", () => {
    const sales = [
      makeSale({ ticker: "NVDA", saleDate: "2026-06-10" }),
      makeSale({ ticker: "NVDA", saleDate: "2026-06-25" }),
    ];
    const warning = checkWashSale(
      { side: "buy", ticker: "NVDA", shares: 1, pricePerShare: 1, accountId: 1 },
      sales,
      [],
      ACCOUNTS,
      TODAY
    );
    expect(warning?.triggers).toHaveLength(2);
    expect(warning?.windowClearsOn).toBe("2026-07-26");
  });
});

describe("checkWashSale — sell side", () => {
  it("flags a loss sell when recently bought shares would still be held", () => {
    const lots = [
      makeLot({ ticker: "AMZN", shares: 10, costPerShare: 220, purchaseDate: "2026-06-20" }),
    ];
    const warning = checkWashSale(
      { side: "sell", ticker: "AMZN", shares: 5, pricePerShare: 200, accountId: 1 },
      [],
      lots,
      ACCOUNTS,
      TODAY
    );
    expect(warning?.kind).toBe("sell-with-recent-buy");
    expect(warning?.windowClearsOn).toBe("2026-07-21");
    expect(warning?.isIraPermanent).toBe(false);
  });

  it("does not flag when the sale consumes the entire recent lot", () => {
    const lots = [
      makeLot({ ticker: "AMZN", shares: 10, costPerShare: 220, purchaseDate: "2026-06-20" }),
    ];
    const warning = checkWashSale(
      { side: "sell", ticker: "AMZN", shares: 10, pricePerShare: 200, accountId: 1 },
      [],
      lots,
      ACCOUNTS,
      TODAY
    );
    expect(warning).toBeNull();
  });

  it("flags recent buys held in OTHER accounts even when selling everything here", () => {
    const lots = [
      makeLot({ ticker: "AMZN", shares: 10, costPerShare: 220, purchaseDate: "2025-01-01", accountId: 1 }),
      makeLot({ ticker: "AMZN", shares: 3, costPerShare: 210, purchaseDate: "2026-06-25", accountId: 2, accountName: "Vanguard Roth" }),
    ];
    const warning = checkWashSale(
      { side: "sell", ticker: "AMZN", shares: 10, pricePerShare: 200, accountId: 1 },
      [],
      lots,
      ACCOUNTS,
      TODAY
    );
    expect(warning).not.toBeNull();
    expect(warning?.triggers[0].accountName).toBe("Vanguard Roth");
    // Replacement shares sit in a Roth IRA — permanent disallowance.
    expect(warning?.isIraPermanent).toBe(true);
    expect(warning?.triggers[0].isIra).toBe(true);
    expect(warning?.message).toContain("PERMANENTLY disallowed");
  });

  it("does not mark permanent when the replacement buy is in a taxable account", () => {
    const lots = [
      makeLot({ ticker: "AMZN", shares: 10, costPerShare: 220, purchaseDate: "2026-06-20", accountId: 1 }),
    ];
    const warning = checkWashSale(
      { side: "sell", ticker: "AMZN", shares: 5, pricePerShare: 200, accountId: 1 },
      [],
      lots,
      ACCOUNTS,
      TODAY
    );
    expect(warning?.isIraPermanent).toBe(false);
    expect(warning?.message).not.toContain("PERMANENTLY");
  });

  it("does not flag a sell at a gain", () => {
    const lots = [
      makeLot({ ticker: "AMZN", shares: 10, costPerShare: 220, purchaseDate: "2026-06-20" }),
    ];
    const warning = checkWashSale(
      { side: "sell", ticker: "AMZN", shares: 5, pricePerShare: 300, accountId: 1 },
      [],
      lots,
      ACCOUNTS,
      TODAY
    );
    expect(warning).toBeNull();
  });

  it("does not flag when all buys are older than 30 days", () => {
    const lots = [
      makeLot({ ticker: "AMZN", shares: 20, costPerShare: 220, purchaseDate: "2026-06-01" }),
    ];
    const warning = checkWashSale(
      { side: "sell", ticker: "AMZN", shares: 5, pricePerShare: 200, accountId: 1 },
      [],
      lots,
      ACCOUNTS,
      TODAY
    );
    expect(warning).toBeNull();
  });
});

describe("previewFifoSell", () => {
  it("consumes lots oldest-first and averages the basis", () => {
    const lots = [
      makeLot({ ticker: "MSFT", shares: 10, costPerShare: 200, purchaseDate: "2026-06-25" }),
      makeLot({ ticker: "MSFT", shares: 10, costPerShare: 100, purchaseDate: "2025-01-01" }),
    ];
    const preview = previewFifoSell(
      { side: "sell", ticker: "MSFT", shares: 15, pricePerShare: 150, accountId: 1 },
      lots
    );
    expect(preview.sharesSold).toBe(15);
    // 10 @ $100 (older lot) + 5 @ $200 = $2000 / 15
    expect(preview.avgCostPerShare).toBeCloseTo(133.333, 2);
    expect(preview.remainingLots).toHaveLength(1);
    expect(preview.remainingLots[0].remainingShares).toBe(5);
  });

  it("only sells lots in the trade's account", () => {
    const lots = [
      makeLot({ ticker: "MSFT", shares: 10, accountId: 1 }),
      makeLot({ ticker: "MSFT", shares: 10, accountId: 2 }),
    ];
    const preview = previewFifoSell(
      { side: "sell", ticker: "MSFT", shares: 20, pricePerShare: 150, accountId: 1 },
      lots
    );
    expect(preview.sharesHeld).toBe(10);
    expect(preview.sharesSold).toBe(10);
  });
});
