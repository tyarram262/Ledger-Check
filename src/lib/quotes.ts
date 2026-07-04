import { getDb } from "@/lib/db";

export interface Quote {
  ticker: string;
  price: number;
  fetchedAt: string;
}

export function getStoredQuotes(tickers: string[]): Map<string, Quote> {
  if (tickers.length === 0) return new Map();
  const placeholders = tickers.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT ticker, price, fetched_at FROM quotes WHERE ticker IN (${placeholders})`
    )
    .all(...tickers.map((t) => t.toUpperCase())) as unknown as {
    ticker: string;
    price: number;
    fetched_at: string;
  }[];
  return new Map(
    rows.map((r) => [
      r.ticker,
      { ticker: r.ticker, price: r.price, fetchedAt: r.fetched_at },
    ])
  );
}

export function toPriceMap(quotes: Map<string, Quote>): Map<string, number> {
  return new Map([...quotes.values()].map((q) => [q.ticker, q.price]));
}

/** Yahoo uses dashes where tickers have dots (BRK.B -> BRK-B). */
function yahooSymbol(ticker: string): string {
  return ticker.toUpperCase().replace(/\./g, "-");
}

async function fetchQuote(ticker: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        yahooSymbol(ticker)
      )}?interval=1d&range=1d`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (ledger-check local MVP)" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/** Fetch current prices for the given tickers and upsert into the quotes
 *  table. Failures leave any previously stored quote untouched. */
export async function refreshQuotes(
  tickers: string[]
): Promise<{ updated: string[]; failed: string[] }> {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()))];
  const updated: string[] = [];
  const failed: string[] = [];
  const now = new Date().toISOString();
  const upsert = getDb().prepare(
    `INSERT INTO quotes (ticker, price, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(ticker) DO UPDATE SET price = excluded.price, fetched_at = excluded.fetched_at`
  );

  const BATCH = 5;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const prices = await Promise.all(batch.map(fetchQuote));
    batch.forEach((ticker, j) => {
      const price = prices[j];
      if (price === null) {
        failed.push(ticker);
      } else {
        upsert.run(ticker, price, now);
        updated.push(ticker);
      }
    });
  }
  return { updated, failed };
}
