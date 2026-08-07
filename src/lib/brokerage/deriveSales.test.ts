import { describe, expect, it } from "vitest";
import { deriveSales } from "@/lib/brokerage/deriveSales";
import type { ActivityInput } from "@/lib/brokerage/reconcileLots";

describe("deriveSales — clean single round trip", () => {
  it("prices a sell against its one prior buy", () => {
    const activities: ActivityInput[] = [
      { externalKey: "buy-1", type: "BUY", tradeDate: "2024-01-01", units: 10, pricePerShare: 100 },
      { externalKey: "sell-1", type: "SELL", tradeDate: "2025-01-01", units: 10, pricePerShare: 80 },
    ];
    const result = deriveSales("AAPL", activities);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0]).toMatchObject({
      externalKey: "sell-1",
      ticker: "AAPL",
      shares: 10,
      salePricePerShare: 80,
      saleDate: "2025-01-01",
      costPerShare: 100,
      acquiredDate: "2024-01-01",
    });
    expect(result.warnings).toHaveLength(0);
  });
});

describe("deriveSales — sell spanning two buy lots", () => {
  it("weighted-averages the basis and takes the earliest consumed lot's date", () => {
    const activities: ActivityInput[] = [
      { externalKey: "buy-1", type: "BUY", tradeDate: "2023-01-01", units: 5, pricePerShare: 100 },
      { externalKey: "buy-2", type: "BUY", tradeDate: "2024-01-01", units: 5, pricePerShare: 200 },
      { externalKey: "sell-1", type: "SELL", tradeDate: "2025-01-01", units: 10, pricePerShare: 150 },
    ];
    const result = deriveSales("NVDA", activities);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0]).toMatchObject({
      shares: 10,
      costPerShare: 150, // (5*100 + 5*200) / 10
      acquiredDate: "2023-01-01", // oldest lot consumed, FIFO
    });
    expect(result.warnings).toHaveLength(0);
  });
});

describe("deriveSales — sell with no prior buy", () => {
  it("returns a null basis and warns", () => {
    const activities: ActivityInput[] = [
      { externalKey: "sell-1", type: "SELL", tradeDate: "2025-01-01", units: 10, pricePerShare: 150 },
    ];
    const result = deriveSales("TSLA", activities);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0]).toMatchObject({ costPerShare: null, acquiredDate: null });
    expect(result.warnings[0]).toContain("TSLA");
    expect(result.warnings[0]).toContain("couldn't be priced");
  });
});

describe("deriveSales — partially-covered sell", () => {
  it("goes all-or-nothing null rather than a blended half-real average", () => {
    // Only 4 shares of history explain a 10-share sell.
    const activities: ActivityInput[] = [
      { externalKey: "buy-1", type: "BUY", tradeDate: "2024-01-01", units: 4, pricePerShare: 100 },
      { externalKey: "sell-1", type: "SELL", tradeDate: "2025-01-01", units: 10, pricePerShare: 150 },
    ];
    const result = deriveSales("GME", activities);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0]).toMatchObject({ shares: 10, costPerShare: null, acquiredDate: null });
    expect(result.warnings[0]).toContain("GME");
  });
});

describe("deriveSales — buy-only history", () => {
  it("produces no sales", () => {
    const activities: ActivityInput[] = [
      { externalKey: "buy-1", type: "BUY", tradeDate: "2024-01-01", units: 10, pricePerShare: 100 },
    ];
    const result = deriveSales("KO", activities);
    expect(result.sales).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("deriveSales — non-trade activity types", () => {
  it("ignores dividends and fees", () => {
    const activities: ActivityInput[] = [
      { externalKey: "buy-1", type: "BUY", tradeDate: "2024-01-01", units: 5, pricePerShare: 100 },
      { externalKey: "div-1", type: "DIVIDEND", tradeDate: "2024-06-01", units: 5, pricePerShare: 999 },
      { externalKey: "sell-1", type: "SELL", tradeDate: "2025-01-01", units: 5, pricePerShare: 120 },
    ];
    const result = deriveSales("KO", activities);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].costPerShare).toBe(100);
  });
});

describe("deriveSales — same-day buy-then-sell ordering", () => {
  it("replays a same-day buy before a same-day sell, regardless of array order", () => {
    const activities: ActivityInput[] = [
      { externalKey: "sell-1", type: "SELL", tradeDate: "2025-01-01", units: 5, pricePerShare: 150 },
      { externalKey: "buy-1", type: "BUY", tradeDate: "2025-01-01", units: 5, pricePerShare: 100 },
    ];
    const result = deriveSales("AMD", activities);
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0]).toMatchObject({ costPerShare: 100, acquiredDate: "2025-01-01" });
    expect(result.warnings).toHaveLength(0);
  });
});

describe("deriveSales — multiple sells against a running FIFO queue", () => {
  it("consumes lots in order across successive sells", () => {
    const activities: ActivityInput[] = [
      { externalKey: "buy-1", type: "BUY", tradeDate: "2023-01-01", units: 10, pricePerShare: 50 },
      { externalKey: "buy-2", type: "BUY", tradeDate: "2024-01-01", units: 10, pricePerShare: 100 },
      { externalKey: "sell-1", type: "SELL", tradeDate: "2024-06-01", units: 10, pricePerShare: 80 },
      { externalKey: "sell-2", type: "SELL", tradeDate: "2025-01-01", units: 10, pricePerShare: 120 },
    ];
    const result = deriveSales("MSFT", activities);
    expect(result.sales).toHaveLength(2);
    expect(result.sales[0]).toMatchObject({ costPerShare: 50, acquiredDate: "2023-01-01" });
    expect(result.sales[1]).toMatchObject({ costPerShare: 100, acquiredDate: "2024-01-01" });
    expect(result.warnings).toHaveLength(0);
  });
});
