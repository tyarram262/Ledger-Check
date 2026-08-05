import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { checkAiRateLimit } from "@/lib/aiRateLimit";
import { getConcentrationThreshold, listLots } from "@/lib/queries";
import { concentrationVerdict, sectorAllocation } from "@/lib/concentration";
import { lookupSecurity } from "@/lib/sectors";
import { getStoredQuotes, toPriceMap } from "@/lib/quotes";
import { buildPositions } from "@/lib/valuation";
import type { Lot } from "@/lib/types";

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

export async function getCachedDigest(): Promise<Digest | null> {
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("digest_cache")
    .select("content, portfolio_hash, created_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;
  return {
    content: row.content,
    createdAt: row.created_at,
    stale: row.portfolio_hash !== portfolioHash(await listLots()),
  };
}

async function buildPrompt(lots: Lot[]): Promise<string> {
  const prices = toPriceMap(
    await getStoredQuotes([...new Set(lots.map((l) => l.ticker))])
  );
  const positions = buildPositions(lots, prices);
  const slices = sectorAllocation(positions);
  const verdict = concentrationVerdict(slices, await getConcentrationThreshold());
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
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      error:
        "CLAUDE_API_KEY isn't set. Add it to .env.local and restart the dev server.",
    };
  }

  const lots = await listLots();
  if (lots.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Add some holdings first — there's nothing to summarize yet.",
    };
  }

  const rateLimit = await checkAiRateLimit();
  if (!rateLimit.ok) {
    return { ok: false, status: 429, error: rateLimit.error };
  }

  const prompt = await buildPrompt(lots);
  const anthropic = new Anthropic({ apiKey });
  let response;
  try {
    response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 502,
      error: `Claude API error: ${message.slice(0, 300)}`,
    };
  }

  if (response.stop_reason === "refusal") {
    return {
      ok: false,
      status: 502,
      error: "Claude declined to generate a digest for this portfolio — try again.",
    };
  }

  const textBlock = response.content.find((b) => b.type === "text");
  const content = textBlock?.text;
  if (!content) {
    return {
      ok: false,
      status: 502,
      error: "Claude returned an empty response — try again.",
    };
  }

  const createdAt = new Date().toISOString();
  const supabase = await createClient();
  const { error: upsertError } = await supabase.from("digest_cache").upsert(
    {
      content: content.trim(),
      portfolio_hash: portfolioHash(lots),
      created_at: createdAt,
    },
    { onConflict: "user_id" }
  );
  if (upsertError) throw new Error(upsertError.message);

  return {
    ok: true,
    digest: { content: content.trim(), createdAt, stale: false },
  };
}
