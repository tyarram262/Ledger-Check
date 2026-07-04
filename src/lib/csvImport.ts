/** CSV holdings import: tolerant of common brokerage export shapes.
 *  Recognizes columns by fuzzy header match; rows that don't parse are
 *  reported per-line rather than failing the whole file. */

export interface ParsedLot {
  ticker: string;
  shares: number;
  costPerShare: number;
  purchaseDate: string; // ISO
}

export interface RowError {
  line: number; // 1-based, counting the header as line 1
  message: string;
}

export interface ParseResult {
  lots: ParsedLot[];
  errors: RowError[];
}

/** Minimal CSV line splitter with double-quote support. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

const HEADER_MATCHERS: Record<string, (h: string) => boolean> = {
  ticker: (h) => h.includes("symbol") || h.includes("ticker"),
  shares: (h) => h.includes("quantity") || h.includes("shares") || h === "qty",
  costPerShare: (h) =>
    (h.includes("cost") && (h.includes("share") || h.includes("avg") || h.includes("average"))) ||
    h.includes("purchase price") ||
    h.includes("price paid"),
  totalCost: (h) => h.includes("cost basis") || h.includes("total cost"),
  date: (h) =>
    h.includes("date") || h.includes("acquired") || h.includes("opened"),
};

function findColumns(header: string[]): Partial<Record<string, number>> {
  const cols: Partial<Record<string, number>> = {};
  const lower = header.map((h) => h.toLowerCase().trim());
  for (const [key, matches] of Object.entries(HEADER_MATCHERS)) {
    const idx = lower.findIndex(matches);
    if (idx !== -1) cols[key] = idx;
  }
  return cols;
}

function parseMoney(raw: string): number {
  return Number(raw.replace(/[$,\s]/g, ""));
}

function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

const TICKER_RE = /^[A-Za-z.\-]{1,10}$/;

export function parseHoldingsCsv(csv: string): ParseResult {
  const lines = csv
    .split(/\r?\n/)
    .map((l, i) => ({ raw: l, line: i + 1 }))
    .filter((l) => l.raw.trim().length > 0);

  if (lines.length < 2) {
    return {
      lots: [],
      errors: [{ line: 1, message: "File needs a header row and at least one data row." }],
    };
  }

  const header = splitCsvLine(lines[0].raw);
  const cols = findColumns(header);
  const missing = ["ticker", "shares", "date"].filter((k) => cols[k] === undefined);
  if (cols.costPerShare === undefined && cols.totalCost === undefined) {
    missing.push("cost (per-share or total)");
  }
  if (missing.length > 0) {
    return {
      lots: [],
      errors: [
        {
          line: 1,
          message: `Couldn't find column(s): ${missing.join(", ")}. Found headers: ${header.join(", ")}`,
        },
      ],
    };
  }

  const lots: ParsedLot[] = [];
  const errors: RowError[] = [];

  for (const { raw, line } of lines.slice(1)) {
    const fields = splitCsvLine(raw);
    const ticker = (fields[cols.ticker!] ?? "").trim().toUpperCase();
    if (!TICKER_RE.test(ticker)) {
      errors.push({ line, message: `Skipped — "${ticker || raw.slice(0, 30)}" isn't a ticker.` });
      continue;
    }
    const shares = parseMoney(fields[cols.shares!] ?? "");
    if (!Number.isFinite(shares) || shares <= 0) {
      errors.push({ line, message: `${ticker}: share count "${fields[cols.shares!]}" isn't a positive number.` });
      continue;
    }
    let costPerShare: number = NaN;
    if (cols.costPerShare !== undefined) {
      costPerShare = parseMoney(fields[cols.costPerShare] ?? "");
    }
    if (!Number.isFinite(costPerShare) && cols.totalCost !== undefined) {
      const total = parseMoney(fields[cols.totalCost] ?? "");
      if (Number.isFinite(total)) costPerShare = total / shares;
    }
    if (!Number.isFinite(costPerShare) || costPerShare < 0) {
      errors.push({ line, message: `${ticker}: couldn't read a cost basis.` });
      continue;
    }
    const date = parseDate(fields[cols.date!] ?? "");
    if (!date) {
      errors.push({ line, message: `${ticker}: date "${fields[cols.date!]}" not recognized (use YYYY-MM-DD or MM/DD/YYYY).` });
      continue;
    }
    lots.push({ ticker, shares, costPerShare: Number(costPerShare.toFixed(4)), purchaseDate: date });
  }

  return { lots, errors };
}
