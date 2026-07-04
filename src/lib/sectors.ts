import sectorMapJson from "@/data/sector-map.json";

export interface SecurityInfo {
  name: string;
  sector: string;
  isEtf: boolean;
  tiltNote?: string;
}

const sectorMap = sectorMapJson as Record<string, SecurityInfo>;

export const UNMAPPED_SECTOR = "Unmapped";

/** Sectors that represent broad exposure rather than a single-sector bet;
 *  excluded when judging single-sector concentration. */
export const NON_CONCENTRATION_SECTORS = new Set([
  "Diversified",
  "Fixed Income",
  "Commodities",
  UNMAPPED_SECTOR,
]);

export function lookupSecurity(ticker: string): SecurityInfo | null {
  return sectorMap[ticker.toUpperCase()] ?? null;
}

export function sectorFor(ticker: string): string {
  return lookupSecurity(ticker)?.sector ?? UNMAPPED_SECTOR;
}

export function knownTickers(): string[] {
  return Object.keys(sectorMap);
}
