import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAX_PROFILE,
  longTermCapGainsRate,
  longTermRate,
  niitRate,
  ordinaryMarginalRate,
  shortTermRate,
  type TaxProfile,
} from "@/lib/taxRates";

function profile(over: Partial<TaxProfile>): TaxProfile {
  return { ...DEFAULT_TAX_PROFILE, ...over };
}

describe("ordinaryMarginalRate", () => {
  it("defaults to the lowest bracket for zero income", () => {
    expect(ordinaryMarginalRate(DEFAULT_TAX_PROFILE)).toBe(10);
  });

  it("picks the correct single bracket", () => {
    expect(ordinaryMarginalRate(profile({ filingStatus: "single", annualTaxableIncome: 60_000 }))).toBe(22);
  });

  it("is exact at a bracket boundary (inclusive of the new rate)", () => {
    expect(ordinaryMarginalRate(profile({ filingStatus: "single", annualTaxableIncome: 50_400 }))).toBe(22);
    expect(ordinaryMarginalRate(profile({ filingStatus: "single", annualTaxableIncome: 50_399 }))).toBe(12);
  });

  it("hits the top single bracket for high income", () => {
    expect(ordinaryMarginalRate(profile({ filingStatus: "single", annualTaxableIncome: 1_000_000 }))).toBe(37);
  });

  it("married filing jointly brackets are roughly double single's", () => {
    expect(ordinaryMarginalRate(profile({ filingStatus: "married_joint", annualTaxableIncome: 100_000 }))).toBe(12);
    expect(ordinaryMarginalRate(profile({ filingStatus: "married_joint", annualTaxableIncome: 101_000 }))).toBe(22);
  });

  it("married filing separately mirrors half of married filing jointly", () => {
    expect(ordinaryMarginalRate(profile({ filingStatus: "married_separate", annualTaxableIncome: 50_400 }))).toBe(22);
  });

  it("head of household has its own lower first bracket", () => {
    expect(ordinaryMarginalRate(profile({ filingStatus: "head_of_household", annualTaxableIncome: 17_700 }))).toBe(12);
  });
});

describe("longTermCapGainsRate", () => {
  it("is 0% under the single 0% threshold", () => {
    expect(longTermCapGainsRate(profile({ filingStatus: "single", annualTaxableIncome: 40_000 }))).toBe(0);
  });

  it("moves to 15% just above the threshold", () => {
    expect(longTermCapGainsRate(profile({ filingStatus: "single", annualTaxableIncome: 49_451 }))).toBe(15);
  });

  it("moves to 20% above the top threshold", () => {
    expect(longTermCapGainsRate(profile({ filingStatus: "single", annualTaxableIncome: 600_000 }))).toBe(20);
  });

  it("married filing jointly has a higher 0% ceiling", () => {
    expect(longTermCapGainsRate(profile({ filingStatus: "married_joint", annualTaxableIncome: 90_000 }))).toBe(0);
    expect(longTermCapGainsRate(profile({ filingStatus: "married_joint", annualTaxableIncome: 100_000 }))).toBe(15);
  });
});

describe("niitRate", () => {
  it("is 0 below the single threshold", () => {
    expect(niitRate(profile({ filingStatus: "single", annualTaxableIncome: 199_999 }))).toBe(0);
  });

  it("kicks in above the single threshold", () => {
    expect(niitRate(profile({ filingStatus: "single", annualTaxableIncome: 200_001 }))).toBe(3.8);
  });

  it("uses the higher married-joint threshold", () => {
    expect(niitRate(profile({ filingStatus: "married_joint", annualTaxableIncome: 220_000 }))).toBe(0);
    expect(niitRate(profile({ filingStatus: "married_joint", annualTaxableIncome: 260_000 }))).toBe(3.8);
  });

  it("uses the lower married-separate threshold", () => {
    expect(niitRate(profile({ filingStatus: "married_separate", annualTaxableIncome: 130_000 }))).toBe(3.8);
  });
});

describe("shortTermRate / longTermRate", () => {
  it("stacks federal + state with no NIIT for a moderate earner", () => {
    const p = profile({ filingStatus: "single", annualTaxableIncome: 60_000, stateTaxRate: 5 });
    expect(shortTermRate(p)).toBe(22 + 0 + 5);
    expect(longTermRate(p)).toBe(15 + 0 + 5);
  });

  it("adds NIIT on top for a high earner", () => {
    const p = profile({ filingStatus: "single", annualTaxableIncome: 600_000, stateTaxRate: 0 });
    expect(shortTermRate(p)).toBe(35 + 3.8 + 0);
    expect(longTermRate(p)).toBe(20 + 3.8 + 0);
  });

  it("long-term rate is always <= short-term rate at the same income", () => {
    const p = profile({ filingStatus: "married_joint", annualTaxableIncome: 500_000, stateTaxRate: 9 });
    expect(longTermRate(p)).toBeLessThanOrEqual(shortTermRate(p));
  });
});
