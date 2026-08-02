import type { Position } from "@/lib/concentration";
import { lookupSecurity } from "@/lib/sectors";
import { holdingsFor } from "@/lib/etfHoldings";

/** A held ETF's contribution to the traded ticker's true exposure. */
export interface OverlapItem {
  ticker: string;
  viaEtf: string;
  etfWeightPct: number;
  dollarValue: number;
}

/** Two held ETFs whose top holdings substantially overlap. */
export interface EtfOverlapPair {
  ticker: string;
  sharedWeightPct: number;
}

export interface OverlapResult {
  /** Post-trade positions with every tracked ETF expanded into its
   *  constituents (plus an unattributed residual for weight outside our
   *  top-holdings data), for downstream scoring. */
  lookThrough: Position[];
  trueExposureBefore: number;
  trueExposureAfter: number;
  contributors: OverlapItem[];
  /** Held ETFs we track but have no (or no itemized) holdings data for. */
  unmappedEtfs: string[];
  etfOverlaps: EtfOverlapPair[];
  sentence: string;
}

/** Two funds sharing more than this much estimated constituent weight are
 *  flagged as substantially redundant (e.g. VOO/IVV/SPY, VTI/VOO). */
const ETF_OVERLAP_THRESHOLD = 30;

function isTrackedEtf(ticker: string): boolean {
  return lookupSecurity(ticker)?.isEtf === true;
}

/**
 * Expands ETF positions into their underlying constituents so downstream
 * code sees "true" look-through exposure rather than fund wrappers. Weight
 * not covered by our top-holdings data (most funds hold far more than the
 * ~10-25 names we track) is kept as a `<TICKER>:UNATTRIBUTED` bucket rather
 * than silently dropped, so total portfolio value is always conserved.
 */
export function lookThroughPositions(positions: Position[]): Position[] {
  const byTicker = new Map<string, number>();
  const add = (ticker: string, value: number) =>
    byTicker.set(ticker, (byTicker.get(ticker) ?? 0) + value);

  for (const p of positions) {
    const holdings = isTrackedEtf(p.ticker) ? holdingsFor(p.ticker) : null;
    if (!holdings || holdings.length === 0) {
      add(p.ticker, p.value);
      continue;
    }
    let attributedPct = 0;
    for (const h of holdings) {
      add(h.ticker, p.value * (h.weight / 100));
      attributedPct += h.weight;
    }
    const residual = p.value * (1 - attributedPct / 100);
    if (Math.abs(residual) > 1e-9) {
      add(`${p.ticker}:UNATTRIBUTED`, residual);
    }
  }
  return [...byTicker.entries()].map(([ticker, value]) => ({ ticker, value }));
}

/**
 * "True" exposure to `ticker` as a % of the portfolio. For an individual
 * stock this includes indirect exposure via held funds (look-through). For
 * an ETF ticker itself, look-through would dissolve the position entirely
 * (a fund doesn't hold itself), so we report direct fund ownership instead
 * — "how exposed am I to the QQQ wrapper" is a different question than
 * "how exposed am I to AAPL-the-company."
 */
function trueExposurePct(positions: Position[], ticker: string): number {
  const total = positions.reduce((sum, p) => sum + p.value, 0);
  if (total <= 0) return 0;
  const source = isTrackedEtf(ticker) ? positions : lookThroughPositions(positions);
  const held = source.filter((p) => p.ticker === ticker).reduce((sum, p) => sum + p.value, 0);
  return (held / total) * 100;
}

function contributorsFor(positions: Position[], ticker: string): OverlapItem[] {
  const items: OverlapItem[] = [];
  for (const p of positions) {
    if (!isTrackedEtf(p.ticker) || p.value <= 0) continue;
    const holdings = holdingsFor(p.ticker);
    const match = holdings?.find((h) => h.ticker === ticker);
    if (!match) continue;
    items.push({
      ticker,
      viaEtf: p.ticker,
      etfWeightPct: match.weight,
      dollarValue: p.value * (match.weight / 100),
    });
  }
  return items.sort((a, b) => b.dollarValue - a.dollarValue);
}

function unmappedEtfsHeld(positions: Position[]): string[] {
  const set = new Set<string>();
  for (const p of positions) {
    if (p.value <= 0 || !isTrackedEtf(p.ticker)) continue;
    const holdings = holdingsFor(p.ticker);
    if (!holdings || holdings.length === 0) set.add(p.ticker);
  }
  return [...set].sort();
}

/** Estimated shared weight between two funds: sum of min(weight in A, weight in B)
 *  over constituents both funds report in their top holdings. An underestimate
 *  (funds hold far more than we track), but directionally reliable for flagging
 *  near-duplicate funds like VOO/SPY. */
function etfVsEtfOverlaps(positions: Position[], tradedTicker: string): EtfOverlapPair[] {
  const tradedHoldings = holdingsFor(tradedTicker);
  if (!tradedHoldings || tradedHoldings.length === 0) return [];
  const tradedWeights = new Map(tradedHoldings.map((h) => [h.ticker, h.weight]));

  const pairs: EtfOverlapPair[] = [];
  const seen = new Set<string>();
  for (const p of positions) {
    if (p.value <= 0 || p.ticker === tradedTicker || seen.has(p.ticker) || !isTrackedEtf(p.ticker)) {
      continue;
    }
    const otherHoldings = holdingsFor(p.ticker);
    if (!otherHoldings || otherHoldings.length === 0) continue;
    seen.add(p.ticker);

    let shared = 0;
    for (const h of otherHoldings) {
      const tradedWeight = tradedWeights.get(h.ticker);
      if (tradedWeight != null) shared += Math.min(tradedWeight, h.weight);
    }
    if (shared > ETF_OVERLAP_THRESHOLD) {
      pairs.push({ ticker: p.ticker, sharedWeightPct: shared });
    }
  }
  return pairs.sort((a, b) => b.sharedWeightPct - a.sharedWeightPct);
}

function buildSentence(
  ticker: string,
  before: number,
  after: number,
  contributors: OverlapItem[],
  etfOverlaps: EtfOverlapPair[]
): string {
  const parts: string[] = [];

  if (contributors.length > 0) {
    const top = contributors[0];
    const rest = contributors.length - 1;
    parts.push(
      `You already hold ${ticker} indirectly through ${top.viaEtf} (${top.etfWeightPct.toFixed(1)}% of that fund)` +
        (rest > 0 ? ` and ${rest} other fund${rest > 1 ? "s" : ""}` : "") +
        `.`
    );
  }

  if (Math.round(after) === Math.round(before)) {
    parts.push(
      `Including fund look-through, this trade leaves your true ${ticker} exposure at about ${Math.round(after)}% of your portfolio.`
    );
  } else if (after > before) {
    parts.push(
      `Including fund look-through, this trade would raise your true ${ticker} exposure from ${Math.round(before)}% to ${Math.round(after)}%.`
    );
  } else {
    parts.push(
      `Including fund look-through, this trade would lower your true ${ticker} exposure from ${Math.round(before)}% to ${Math.round(after)}%.`
    );
  }

  if (etfOverlaps.length > 0) {
    const top = etfOverlaps[0];
    parts.push(
      `${ticker} also shares an estimated ${Math.round(top.sharedWeightPct)}% of its holdings with ${top.ticker}, which you already hold.`
    );
  }

  return parts.join(" ");
}

/**
 * ETF-overlap check for a hypothetical trade. Takes the same before/after
 * position snapshots `simulate.ts` already computes for concentration —
 * reusing them (rather than re-deriving the trade's dollar impact here)
 * keeps "what does this trade do to position value" defined in exactly one
 * place.
 */
export function computeOverlap(
  ticker: string,
  beforePositions: Position[],
  afterPositions: Position[]
): OverlapResult {
  const t = ticker.toUpperCase();

  const trueExposureBefore = trueExposurePct(beforePositions, t);
  const trueExposureAfter = trueExposurePct(afterPositions, t);
  const contributors = contributorsFor(beforePositions, t);
  const unmappedEtfs = unmappedEtfsHeld(beforePositions);
  const etfOverlaps = isTrackedEtf(t) ? etfVsEtfOverlaps(beforePositions, t) : [];
  const lookThrough = lookThroughPositions(afterPositions);

  return {
    lookThrough,
    trueExposureBefore,
    trueExposureAfter,
    contributors,
    unmappedEtfs,
    etfOverlaps,
    sentence: buildSentence(t, trueExposureBefore, trueExposureAfter, contributors, etfOverlaps),
  };
}
