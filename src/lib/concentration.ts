import { NON_CONCENTRATION_SECTORS, sectorFor } from "@/lib/sectors";

export interface Position {
  ticker: string;
  /** Dollar value of the position. MVP uses cost basis (no live price feed). */
  value: number;
}

export interface SectorSlice {
  sector: string;
  value: number;
  pct: number; // 0-100
}

export type ConcentrationLevel = "diversified" | "elevated" | "high";

export interface ConcentrationVerdict {
  level: ConcentrationLevel;
  topSector: string | null;
  topPct: number;
  sentence: string;
}

export const ELEVATED_THRESHOLD = 25;
export const HIGH_THRESHOLD = 40;

export function sectorAllocation(positions: Position[]): SectorSlice[] {
  // Accumulate before filtering: sells are modeled as negative adjustments
  // that must net against the sector's positive value.
  const bySector = new Map<string, number>();
  for (const p of positions) {
    const sector = sectorFor(p.ticker);
    bySector.set(sector, (bySector.get(sector) ?? 0) + p.value);
  }
  const entries = [...bySector.entries()].filter(([, value]) => value > 1e-9);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total === 0) return [];
  return entries
    .map(([sector, value]) => ({ sector, value, pct: (value / total) * 100 }))
    .sort((a, b) => b.value - a.value);
}

export function concentrationVerdict(
  slices: SectorSlice[]
): ConcentrationVerdict {
  // Judge concentration only on single-sector bets; owning 100% VTI is not
  // "100% concentrated in Diversified".
  const sectorBets = slices.filter(
    (s) => !NON_CONCENTRATION_SECTORS.has(s.sector)
  );
  if (sectorBets.length === 0) {
    return {
      level: "diversified",
      topSector: null,
      topPct: 0,
      sentence:
        slices.length === 0
          ? "Add holdings to see your sector concentration."
          : "Your portfolio is in broad-market or non-equity funds — no single-sector concentration to flag.",
    };
  }

  const top = sectorBets[0];
  const pctText = `${Math.round(top.pct)}% of your portfolio is in ${top.sector}`;

  if (top.pct > HIGH_THRESHOLD) {
    return {
      level: "high",
      topSector: top.sector,
      topPct: top.pct,
      sentence: `${pctText} — that's high concentration.`,
    };
  }
  if (top.pct > ELEVATED_THRESHOLD) {
    return {
      level: "elevated",
      topSector: top.sector,
      topPct: top.pct,
      sentence: `${pctText} — that's elevated concentration.`,
    };
  }
  return {
    level: "diversified",
    topSector: top.sector,
    topPct: top.pct,
    sentence: `Your largest sector bet is ${top.sector} at ${Math.round(top.pct)}% — within a diversified range.`,
  };
}
