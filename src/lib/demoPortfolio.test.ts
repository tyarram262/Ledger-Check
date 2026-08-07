import { describe, expect, it } from "vitest";
import { demoContext, DEMO_SUGGESTED_TRADE } from "@/lib/demoPortfolio";
import { simulateTrade } from "@/lib/simulate";
import { DEFAULT_ELEVATED_THRESHOLD } from "@/lib/concentration";
import { DEFAULT_TAX_PROFILE } from "@/lib/taxRates";
import { lookupSecurity } from "@/lib/sectors";
import { daysBetween, todayIso } from "@/lib/dates";
import { WASH_SALE_WINDOW_DAYS } from "@/lib/washSale";

/**
 * Pins the fixture that backs the public `/demo` page (see
 * `src/app/demo/page.tsx` and `src/app/api/demo/simulate/route.ts`). This
 * fixture is load-bearing for the landing page's core claim — that buying
 * NVDA in the IRA demonstrates the cross-account, permanently-disallowed
 * wash sale — so a regression here breaks the product's own pitch, not just
 * a test.
 */
describe("demoPortfolio", () => {
  it("every fixture ticker resolves in the sector map (no Unmapped in the showcase)", () => {
    const { lots } = demoContext();
    for (const lot of lots) {
      expect(lookupSecurity(lot.ticker), `${lot.ticker} should be mapped`).not.toBeNull();
    }
  });

  it("keeps the demo sale inside the wash-sale window relative to today", () => {
    const { sales } = demoContext();
    const sale = sales[0];
    const age = daysBetween(sale.saleDate, todayIso());
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThanOrEqual(WASH_SALE_WINDOW_DAYS);
  });

  it("the suggested trade triggers a wash sale that is permanently disallowed (IRA)", () => {
    const { accounts, lots, sales, prices } = demoContext();
    const outcome = simulateTrade(
      DEMO_SUGGESTED_TRADE,
      lots,
      sales,
      accounts,
      todayIso(),
      prices,
      DEFAULT_ELEVATED_THRESHOLD,
      DEFAULT_TAX_PROFILE
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.washSale?.kind).toBe("buy-after-loss");
    expect(outcome.result.washSale?.isIraPermanent).toBe(true);
    expect(outcome.result.washSale?.triggers.length).toBeGreaterThan(0);
  });

  it("the same trade in the taxable account is an ordinary wash sale, not IRA-permanent", () => {
    const { accounts, lots, sales, prices } = demoContext();
    const taxableTrade = { ...DEMO_SUGGESTED_TRADE, accountId: 1 };
    const outcome = simulateTrade(
      taxableTrade,
      lots,
      sales,
      accounts,
      todayIso(),
      prices,
      DEFAULT_ELEVATED_THRESHOLD,
      DEFAULT_TAX_PROFILE
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.washSale?.kind).toBe("buy-after-loss");
    expect(outcome.result.washSale?.isIraPermanent).toBe(false);
  });

  it("shows ETF look-through overlap for the NVDA buy (VOO/QQQ both hold it)", () => {
    const { accounts, lots, sales, prices } = demoContext();
    const outcome = simulateTrade(
      DEMO_SUGGESTED_TRADE,
      lots,
      sales,
      accounts,
      todayIso(),
      prices,
      DEFAULT_ELEVATED_THRESHOLD,
      DEFAULT_TAX_PROFILE
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.etfOverlap.contributors.length).toBeGreaterThan(0);
    const viaEtfs = outcome.result.etfOverlap.contributors.map((c) => c.viaEtf);
    expect(viaEtfs).toEqual(expect.arrayContaining(["VOO", "QQQ"]));
  });

  it("shows high sector concentration in Information Technology before the trade", () => {
    const { lots, prices } = demoContext();
    const outcome = simulateTrade(
      DEMO_SUGGESTED_TRADE,
      lots,
      [],
      demoContext().accounts,
      todayIso(),
      prices,
      DEFAULT_ELEVATED_THRESHOLD,
      DEFAULT_TAX_PROFILE
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.before.verdict.topSector).toBe("Information Technology");
    expect(outcome.result.before.verdict.level).not.toBe("diversified");
  });
});
