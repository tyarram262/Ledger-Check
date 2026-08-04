import { describe, expect, it } from "vitest";
import { reconcileLots, type ActivityInput, type RawTaxLot } from "@/lib/brokerage/reconcileLots";

describe("reconcileLots — tax-lot fast path", () => {
  it("maps tax lots 1:1 with exact dates when present", () => {
    const taxLots: RawTaxLot[] = [
      { externalKey: "lot-1", shares: 5, costPerShare: 100, purchaseDate: "2024-01-01" },
      { externalKey: "lot-2", shares: 5, costPerShare: 120, purchaseDate: "2025-06-01" },
    ];
    const result = reconcileLots({ ticker: "AAPL", shares: 10, averageCostPerShare: 110 }, taxLots, []);
    expect(result.lots).toHaveLength(2);
    expect(result.lots.every((l) => l.basis === "tax-lot")).toBe(true);
    expect(result.lots.every((l) => l.purchaseDate !== null)).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns but still uses tax-lot data as-is when totals don't match the position", () => {
    const taxLots: RawTaxLot[] = [{ externalKey: "lot-1", shares: 8, costPerShare: 100, purchaseDate: "2024-01-01" }];
    const result = reconcileLots({ ticker: "AAPL", shares: 10, averageCostPerShare: 100 }, taxLots, []);
    expect(result.lots).toHaveLength(1);
    expect(result.warnings[0]).toContain("AAPL");
  });

  it("ignores activities entirely when tax lots are present", () => {
    const taxLots: RawTaxLot[] = [{ externalKey: "lot-1", shares: 10, costPerShare: 100, purchaseDate: "2024-01-01" }];
    const activities: ActivityInput[] = [
      { externalKey: "act-1", type: "BUY", tradeDate: "2026-01-01", units: 10, pricePerShare: 999 },
    ];
    const result = reconcileLots({ ticker: "AAPL", shares: 10, averageCostPerShare: 100 }, taxLots, activities);
    expect(result.lots[0].costPerShare).toBe(100); // from the tax lot, not the activity
  });
});

describe("reconcileLots — activity replay (no tax-lot data)", () => {
  it("reconstructs a single buy as one dated lot", () => {
    const activities: ActivityInput[] = [
      { externalKey: "act-1", type: "BUY", tradeDate: "2024-03-15", units: 10, pricePerShare: 150 },
    ];
    const result = reconcileLots({ ticker: "MSFT", shares: 10, averageCostPerShare: 150 }, null, activities);
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0]).toMatchObject({
      ticker: "MSFT",
      shares: 10,
      costPerShare: 150,
      purchaseDate: "2024-03-15",
      basis: "activity-replay",
    });
    expect(result.warnings).toHaveLength(0);
  });

  it("FIFO-consumes an earlier buy with a later sell, leaving only the remainder", () => {
    const activities: ActivityInput[] = [
      { externalKey: "buy-1", type: "BUY", tradeDate: "2023-01-01", units: 10, pricePerShare: 100 },
      { externalKey: "buy-2", type: "BUY", tradeDate: "2024-01-01", units: 10, pricePerShare: 200 },
      { externalKey: "sell-1", type: "SELL", tradeDate: "2025-01-01", units: 10, pricePerShare: 150 },
    ];
    const result = reconcileLots({ ticker: "NVDA", shares: 10, averageCostPerShare: 200 }, null, activities);
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0]).toMatchObject({ externalKey: "buy-2", shares: 10, costPerShare: 200, purchaseDate: "2024-01-01" });
  });

  it("ignores non-trade activity types (dividends, fees)", () => {
    const activities: ActivityInput[] = [
      { externalKey: "buy-1", type: "BUY", tradeDate: "2024-01-01", units: 5, pricePerShare: 100 },
      { externalKey: "div-1", type: "DIVIDEND", tradeDate: "2024-06-01", units: 5, pricePerShare: 999 },
    ];
    const result = reconcileLots({ ticker: "KO", shares: 5, averageCostPerShare: 100 }, null, activities);
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].costPerShare).toBe(100);
  });

  it("sorts out-of-order activities by trade date before replaying", () => {
    const activities: ActivityInput[] = [
      { externalKey: "buy-2", type: "BUY", tradeDate: "2024-06-01", units: 5, pricePerShare: 200 },
      { externalKey: "buy-1", type: "BUY", tradeDate: "2023-01-01", units: 5, pricePerShare: 100 },
      { externalKey: "sell-1", type: "SELL", tradeDate: "2025-01-01", units: 5, pricePerShare: 150 },
    ];
    // FIFO should consume the 2023 lot (oldest) regardless of array order.
    const result = reconcileLots({ ticker: "AMD", shares: 5, averageCostPerShare: 200 }, null, activities);
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].externalKey).toBe("buy-2");
  });
});

describe("reconcileLots — shallow history (shortfall -> residual lot)", () => {
  it("buckets the unexplained shares into one null-dated residual lot", () => {
    // History only shows a 5-share buy, but the position holds 12 — the
    // other 7 predate the brokerage's exposed transaction history.
    const activities: ActivityInput[] = [
      { externalKey: "buy-1", type: "BUY", tradeDate: "2025-01-01", units: 5, pricePerShare: 100 },
    ];
    const result = reconcileLots({ ticker: "TSLA", shares: 12, averageCostPerShare: 120 }, null, activities);
    expect(result.lots).toHaveLength(2);
    const residual = result.lots.find((l) => l.basis === "position-residual");
    expect(residual).toBeDefined();
    expect(residual?.shares).toBe(7);
    expect(residual?.purchaseDate).toBeNull();
    expect(residual?.costPerShare).toBe(120); // from average_purchase_price, not fabricated
    expect(result.warnings[0]).toContain("no known purchase date");
  });

  it("buckets the entire position as residual when there's no transaction history at all", () => {
    const result = reconcileLots({ ticker: "GLD", shares: 20, averageCostPerShare: 180 }, null, []);
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0]).toMatchObject({ shares: 20, purchaseDate: null, basis: "position-residual" });
  });
});

describe("reconcileLots — surplus (history overexplains the position)", () => {
  it("trims the oldest reconstructed lots first to match the live position", () => {
    const activities: ActivityInput[] = [
      { externalKey: "buy-1", type: "BUY", tradeDate: "2023-01-01", units: 10, pricePerShare: 100 },
      { externalKey: "buy-2", type: "BUY", tradeDate: "2024-01-01", units: 10, pricePerShare: 200 },
    ];
    // Only 12 actually held (e.g. 8 were transferred out with no matching
    // SELL activity in this history) — trim 8 from the oldest lot first.
    const result = reconcileLots({ ticker: "SPY", shares: 12, averageCostPerShare: 200 }, null, activities);
    const totalShares = result.lots.reduce((sum, l) => sum + l.shares, 0);
    expect(totalShares).toBe(12);
    const oldest = result.lots.find((l) => l.externalKey === "buy-1");
    expect(oldest?.shares).toBe(2); // 10 - 8 trimmed
    const newest = result.lots.find((l) => l.externalKey === "buy-2");
    expect(newest?.shares).toBe(10); // untouched
    expect(result.warnings[0]).toContain("trimmed");
  });

  it("drops a lot entirely once fully trimmed, rather than leaving a zero-share lot", () => {
    const activities: ActivityInput[] = [
      { externalKey: "buy-1", type: "BUY", tradeDate: "2023-01-01", units: 5, pricePerShare: 100 },
      { externalKey: "buy-2", type: "BUY", tradeDate: "2024-01-01", units: 10, pricePerShare: 200 },
    ];
    const result = reconcileLots({ ticker: "QQQ", shares: 10, averageCostPerShare: 200 }, null, activities);
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].externalKey).toBe("buy-2");
  });
});

describe("reconcileLots — exact match", () => {
  it("produces no residual or trim when replay exactly matches the position", () => {
    const activities: ActivityInput[] = [
      { externalKey: "buy-1", type: "BUY", tradeDate: "2024-01-01", units: 10, pricePerShare: 150 },
    ];
    const result = reconcileLots({ ticker: "IBM", shares: 10, averageCostPerShare: 150 }, null, activities);
    expect(result.lots).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });
});
