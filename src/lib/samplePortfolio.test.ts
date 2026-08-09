import { describe, expect, it } from "vitest";
import { sampleSeedPlan } from "@/lib/samplePortfolio";
import { demoLots, demoSales } from "@/lib/demoPortfolio";
import { daysBetween } from "@/lib/dates";
import { WASH_SALE_WINDOW_DAYS } from "@/lib/washSale";

const TODAY = "2026-08-08";

describe("sampleSeedPlan", () => {
  it("mirrors the /demo fixture's tickers, shares, and costs per account", () => {
    const plan = sampleSeedPlan(TODAY);
    const fixtureLots = demoLots(TODAY);

    const seededLots = [...plan.lotsByFixtureAccountId.values()].flat();
    expect(seededLots.length).toBe(fixtureLots.length);

    for (const fixture of fixtureLots) {
      const seeded = plan.lotsByFixtureAccountId.get(fixture.accountId);
      expect(seeded, `fixture account ${fixture.accountId} should have seeded lots`).toBeDefined();
      const match = seeded!.find((l) => l.ticker === fixture.ticker);
      expect(match, `${fixture.ticker} should be in the seed plan`).toBeDefined();
      expect(match!.shares).toBe(fixture.shares);
      expect(match!.costPerShare).toBe(fixture.costPerShare);
      expect(match!.purchaseDate).toBe(fixture.purchaseDate);
    }
  });

  it("mirrors the /demo fixture's sale", () => {
    const plan = sampleSeedPlan(TODAY);
    const fixtureSales = demoSales(TODAY);
    expect(plan.sales.length).toBe(fixtureSales.length);

    const fixtureSale = fixtureSales[0];
    const seededSale = plan.sales[0];
    expect(seededSale.ticker).toBe(fixtureSale.ticker);
    expect(seededSale.shares).toBe(fixtureSale.shares);
    expect(seededSale.salePricePerShare).toBe(fixtureSale.salePricePerShare);
    expect(seededSale.costPerShare).toBe(fixtureSale.costPerShare);
    expect(seededSale.saleDate).toBe(fixtureSale.saleDate);
    expect(seededSale.fixtureAccountId).toBe(fixtureSale.accountId);
  });

  it("keeps the seeded sale inside the wash-sale window relative to the passed date", () => {
    const plan = sampleSeedPlan(TODAY);
    const age = daysBetween(plan.sales[0].saleDate, TODAY);
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThanOrEqual(WASH_SALE_WINDOW_DAYS);
  });

  it("prefixes both account names as sample data, distinct from the /demo fixture's bare names", () => {
    const plan = sampleSeedPlan(TODAY);
    for (const account of plan.accounts) {
      expect(account.name).toMatch(/^Sample /);
    }
    const fixtureNames = new Set(demoLots(TODAY).map((l) => l.accountName));
    for (const account of plan.accounts) {
      expect(fixtureNames.has(account.name)).toBe(false);
    }
  });

  it("carries no fixture row ids for the caller to accidentally persist", () => {
    const plan = sampleSeedPlan(TODAY);
    for (const account of plan.accounts) {
      expect(account).not.toHaveProperty("id");
    }
    for (const lots of plan.lotsByFixtureAccountId.values()) {
      for (const lot of lots) {
        expect(lot).not.toHaveProperty("id");
      }
    }
    for (const sale of plan.sales) {
      expect(sale).not.toHaveProperty("id");
    }
  });

  it("defaults to today when no date is passed", () => {
    expect(() => sampleSeedPlan()).not.toThrow();
  });
});
