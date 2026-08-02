/**
 * Federal tax-rate tables used to *estimate* (not calculate precisely) the
 * tax impact of a trade. This is a marginal-rate approximation, not a full
 * effective-rate return calculation — see the "Known limitations" copy on
 * /settings for what that means in practice.
 *
 * Figures are for tax year 2026 (IRS Rev. Proc. 2025-32, inflation-adjusted
 * ordinary brackets and standard deduction; long-term capital gains
 * breakpoints per the same revenue procedure). NIIT thresholds are set by
 * statute (26 U.S.C. §1411) and are NOT inflation-indexed, so they carry
 * over unchanged from prior years. Married-filing-separately ordinary
 * brackets and capital-gains 15%/20% breakpoints are exactly half of
 * married-filing-jointly, per IRS convention; the MFS 0% capital-gains
 * breakpoint matches single filers, also per IRS convention.
 *
 * Update this file's TAX_YEAR and tables annually.
 */

export const TAX_YEAR = 2026;

export type FilingStatus =
  | "single"
  | "married_joint"
  | "married_separate"
  | "head_of_household";

export interface TaxProfile {
  filingStatus: FilingStatus;
  /** Estimated total annual taxable income (after deductions), used only to
   *  locate the marginal bracket — not itself taxed by this module. */
  annualTaxableIncome: number;
  /** Flat state capital-gains/income rate, 0-100. 0 means "not modeled" (many
   *  states, or the user hasn't set one), not "no state tax owed". */
  stateTaxRate: number;
}

export const DEFAULT_TAX_PROFILE: TaxProfile = {
  filingStatus: "single",
  annualTaxableIncome: 0,
  stateTaxRate: 0,
};

/** [rate percent, income the bracket starts at] pairs, ascending. */
type Bracket = [rate: number, startsAt: number];

const ORDINARY_BRACKETS: Record<FilingStatus, Bracket[]> = {
  single: [
    [10, 0],
    [12, 12_400],
    [22, 50_400],
    [24, 105_700],
    [32, 201_775],
    [35, 256_225],
    [37, 640_600],
  ],
  married_joint: [
    [10, 0],
    [12, 24_800],
    [22, 100_800],
    [24, 211_400],
    [32, 403_550],
    [35, 512_450],
    [37, 768_700],
  ],
  married_separate: [
    [10, 0],
    [12, 12_400],
    [22, 50_400],
    [24, 105_700],
    [32, 201_775],
    [35, 256_225],
    [37, 384_350],
  ],
  head_of_household: [
    [10, 0],
    [12, 17_700],
    [22, 67_450],
    [24, 105_700],
    [32, 201_775],
    [35, 256_200],
    [37, 640_600],
  ],
};

const LTCG_BRACKETS: Record<FilingStatus, Bracket[]> = {
  single: [
    [0, 0],
    [15, 49_450],
    [20, 545_500],
  ],
  married_joint: [
    [0, 0],
    [15, 98_900],
    [20, 613_700],
  ],
  married_separate: [
    [0, 0],
    [15, 49_450],
    [20, 306_850],
  ],
  head_of_household: [
    [0, 0],
    [15, 66_200],
    [20, 579_600],
  ],
};

/** Net Investment Income Tax MAGI thresholds — statutory, not inflation-indexed. */
const NIIT_THRESHOLD: Record<FilingStatus, number> = {
  single: 200_000,
  married_joint: 250_000,
  married_separate: 125_000,
  head_of_household: 200_000,
};
const NIIT_RATE = 3.8;

function rateForBracket(brackets: Bracket[], income: number): number {
  let rate = brackets[0][0];
  for (const [r, startsAt] of brackets) {
    if (income >= startsAt) rate = r;
    else break;
  }
  return rate;
}

/** Marginal federal rate on ordinary income (short-term gains are taxed as ordinary income). */
export function ordinaryMarginalRate(profile: TaxProfile): number {
  return rateForBracket(ORDINARY_BRACKETS[profile.filingStatus], profile.annualTaxableIncome);
}

/** Marginal federal long-term capital gains rate (0 / 15 / 20). */
export function longTermCapGainsRate(profile: TaxProfile): number {
  return rateForBracket(LTCG_BRACKETS[profile.filingStatus], profile.annualTaxableIncome);
}

/**
 * 3.8% surtax once MAGI exceeds the filing-status threshold. We use
 * `annualTaxableIncome` as a MAGI stand-in — an approximation, since real
 * MAGI adds back certain deductions this app doesn't collect.
 */
export function niitRate(profile: TaxProfile): number {
  return profile.annualTaxableIncome > NIIT_THRESHOLD[profile.filingStatus] ? NIIT_RATE : 0;
}

/** Combined estimated rate applied to a short-term gain: federal ordinary + NIIT + state. */
export function shortTermRate(profile: TaxProfile): number {
  return ordinaryMarginalRate(profile) + niitRate(profile) + profile.stateTaxRate;
}

/** Combined estimated rate applied to a long-term gain: federal LTCG + NIIT + state. */
export function longTermRate(profile: TaxProfile): number {
  return longTermCapGainsRate(profile) + niitRate(profile) + profile.stateTaxRate;
}
