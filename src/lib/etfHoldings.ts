import etfHoldingsJson from "@/data/etf-holdings.json";

export interface EtfHolding {
  ticker: string;
  /** Percent of fund AUM, 0-100. */
  weight: number;
}

interface EtfHoldingsEntry {
  asOf: string;
  holdings: EtfHolding[];
  note?: string;
}

const etfHoldingsMap = etfHoldingsJson as Record<string, EtfHoldingsEntry>;

/**
 * Top-holdings snapshot for a known ETF, or `null` when the ticker isn't an
 * ETF we have data for. An empty `holdings` array (funds like AGG/GLD, or
 * broad international/small-cap funds) is a deliberate "no meaningful
 * overlap data" signal, not "this fund holds nothing" — callers should
 * treat `[]` and `null` differently: `null` means "not an ETF we track",
 * `[]` means "an ETF we track, but overlap isn't modeled for it" (see `note`).
 */
export function holdingsFor(ticker: string): EtfHolding[] | null {
  const entry = etfHoldingsMap[ticker.toUpperCase()];
  return entry ? entry.holdings : null;
}

export function noteFor(ticker: string): string | null {
  return etfHoldingsMap[ticker.toUpperCase()]?.note ?? null;
}

export function asOfFor(ticker: string): string | null {
  return etfHoldingsMap[ticker.toUpperCase()]?.asOf ?? null;
}

export function knownEtfTickers(): string[] {
  return Object.keys(etfHoldingsMap);
}
