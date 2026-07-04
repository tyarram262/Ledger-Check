import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { listLots } from "@/lib/queries";
import { concentrationVerdict, sectorAllocation } from "@/lib/concentration";
import { lookupSecurity } from "@/lib/sectors";
import { getStoredQuotes, toPriceMap } from "@/lib/quotes";
import { buildPositions } from "@/lib/valuation";
import type { Lot } from "@/lib/types";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

export interface Digest {
  content: string;
  createdAt: string;
  /** True when holdings changed since this digest was generated. */
  stale: boolean;
}

function portfolioHash(lots: Lot[]): string {
  const canonical = lots
    .map((l) => `${l.accountId}:${l.ticker}:${l.shares}:${l.costPerShare}`)
    .sort()
    .join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export function getCachedDigest(): Digest | null {
  const row = getDb()
    .prepare("SELECT content, portfolio_hash, created_at FROM digest_cache WHERE id = 1")
    .get() as
    | { content: string; portfolio_hash: string; created_at: string }
    | undefined;
  if (!row) return null;
  return {
    content: row.content,
    createdAt: row.created_at,
    stale: row.portfolio_hash !== portfolioHash(listLots()),
  };
}

function buildPrompt(lots: Lot[]): string {
  const prices = toPriceMap(
    getStoredQuotes([...new Set(lots.map((l) => l.ticker))])
  );
  const positions = buildPositions(lots, prices);
  const slices = sectorAllocation(positions);
  const verdict = concentrationVerdict(slices);
  const holdings = lots.map((l) => {
    const info = lookupSecurity(l.ticker);
    return {
      ticker: l.ticker,
      name: info?.name ?? "unknown",
      sector: info?.sector ?? "Unmapped",
      isEtf: info?.isEtf ?? false,
      accountType: l.accountName,
      dollarValue: Math.round(
        l.shares * (prices.get(l.ticker) ?? l.costPerShare)
      ),
    };
  });

  return `You are a plain-English financial explainer for someone who is not a finance expert.

Here is their portfolio (market value where available, else cost basis):
${JSON.stringify(holdings, null, 2)}

Sector breakdown:
${JSON.stringify(
    slices.map((s) => ({ sector: s.sector, pct: Math.round(s.pct) })),
    null,
    2
  )}

Concentration assessment: ${verdict.sentence}

Write a 3-4 sentence summary of this portfolio's single biggest risk. Rules:
- Plain English, no jargon (no "beta", "drawdown", "basis points").
- Focus on the biggest risk only — usually concentration in one sector, one company, or overlap between an ETF and individual stocks.
- Do not recommend buying or selling any specific security.
- Do not use bullet points or headers; write flowing sentences.`;
}

export async function generateDigest(): Promise<
  { ok: true; digest: Digest } | { ok: false; error: string; status: number }
> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      error:
        "GEMINI_API_KEY isn't set. Add it to .env.local and restart the dev server.",
    };
  }

  const lots = listLots();
  if (lots.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Add some holdings first — there's nothing to summarize yet.",
    };
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(lots) }] }],
      }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return {
      ok: false,
      status: 502,
      error: `Gemini API error (${res.status}): ${detail.slice(0, 300)}`,
    };
  }

  const data = await res.json();
  const content: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    return {
      ok: false,
      status: 502,
      error: "Gemini returned an empty response — try again.",
    };
  }

  const createdAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO digest_cache (id, content, portfolio_hash, created_at)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         content = excluded.content,
         portfolio_hash = excluded.portfolio_hash,
         created_at = excluded.created_at`
    )
    .run(content.trim(), portfolioHash(lots), createdAt);

  return {
    ok: true,
    digest: { content: content.trim(), createdAt, stale: false },
  };
}
