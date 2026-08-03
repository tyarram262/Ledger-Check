import Anthropic from "@anthropic-ai/sdk";
import type { SimulatedTrade } from "@/lib/washSale";
import type { SimulationResult } from "@/lib/simulate";

export interface TradeReview {
  content: string;
  createdAt: string;
}

const RATIONALE_MAX_CHARS = 1000;

/** Trims and caps a user-supplied rationale, or returns null for blank input. */
export function normalizeRationale(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, RATIONALE_MAX_CHARS);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Builds the facts the model is allowed to reference — exclusively fields
 * already computed by `simulateTrade` (`washSale.ts`, `taxCheck.ts`,
 * `etfOverlap.ts`, `scores.ts`). No raw prices or portfolio data go in
 * here; the model narrates and critiques numbers that already exist, it
 * never computes anything itself (CLAUDE.md: "financial calculations must
 * never rely on AI").
 */
function buildFacts(trade: SimulatedTrade, r: SimulationResult) {
  return {
    trade: {
      side: trade.side,
      ticker: trade.ticker.toUpperCase(),
      shares: trade.shares,
      pricePerShare: trade.pricePerShare,
      dollarValue: Math.round(trade.shares * trade.pricePerShare),
    },
    verdict: r.verdictSentence,
    severity: r.severity,
    concentrationBefore: r.before.verdict.sentence,
    concentrationAfter: r.after.verdict.sentence,
    washSale: r.washSale && {
      message: r.washSale.message,
      isIraPermanent: r.washSale.isIraPermanent,
    },
    futureRebuyNote: r.futureRebuyNote,
    sellPreview: r.sellPreview,
    overlap: {
      sentence: r.etfOverlap.sentence,
      contributors: r.etfOverlap.contributors.map((c) => ({
        viaEtf: c.viaEtf,
        etfWeightPct: c.etfWeightPct,
        dollarValue: Math.round(c.dollarValue),
      })),
      etfOverlaps: r.etfOverlap.etfOverlaps,
    },
    tax: r.taxCheck && {
      isIraAccount: r.taxCheck.isIraAccount,
      shortTermGainLoss: r.taxCheck.shortTermGainLoss,
      longTermGainLoss: r.taxCheck.longTermGainLoss,
      shortTermWarning: r.taxCheck.shortTermWarning,
      longTermCountdown: r.taxCheck.longTermCountdown,
      estimatedTax: r.taxCheck.estimatedTax,
    },
    scores: {
      diversification: {
        before: r.scores.diversification.before.score,
        after: r.scores.diversification.after.score,
        afterSentence: r.scores.diversification.after.sentence,
      },
      risk: {
        before: r.scores.risk.before.score,
        after: r.scores.risk.after.score,
        afterSentence: r.scores.risk.after.sentence,
      },
    },
  };
}

function buildPrompt(trade: SimulatedTrade, r: SimulationResult, rationale: string | null): string {
  const facts = buildFacts(trade, r);
  const rationaleBlock = rationale
    ? `\nThe investor's own stated reason for this trade (their words, verbatim):\n"""\n${rationale}\n"""\nEngage with this reasoning directly — agree with the parts that hold up, and challenge the parts that don't.\n`
    : `\nThe investor did not state a reason for this trade. Critique the trade on its own merits, and note that you can't assess their specific reasoning because none was given.\n`;

  return `You are a calm, fiduciary-style devil's advocate reviewing a trade an investor is considering — not a hype machine, not a doomsayer. Your job is to challenge assumptions, not to approve or reject the trade.

Computed facts about this trade and its impact (all numbers below are already calculated by deterministic code — treat them as ground truth):
${JSON.stringify(facts, null, 2)}
${rationaleBlock}
Rules, all mandatory:
- Never say "buy", "sell", "hold", or that anything will outperform/underperform. No price targets, no predictions.
- Every number you cite must appear verbatim in the facts above. Do not compute, estimate, infer, or round any figure that isn't given — if you don't have a fact to support a claim, say you can't assess it instead of guessing.
- If tax.isIraAccount is true, the zeroed tax figures mean "no current-year tax consequence in an IRA" — never present that as a reason IN FAVOR of the trade.
- Where the investor's reasoning (or the trade itself, if no reasoning was given) is genuinely sound, say so plainly. Don't manufacture objections for their own sake.
- 2-4 short paragraphs, plain English, no jargon, no markdown, no bullet points, no headers.`;
}

/**
 * On-demand, stateless AI second opinion on a single simulated trade —
 * mirrors `digest.ts`'s Claude-call shape exactly (same model, same
 * error handling) but is never cached: a trade review is invoked
 * explicitly per simulation, doesn't need to survive a refresh, and a
 * per-trade cache key would rarely hit since users tweak share counts
 * between clicks.
 */
export async function generateTradeReview(
  trade: SimulatedTrade,
  result: SimulationResult,
  rationale: string | null
): Promise<{ ok: true; review: TradeReview } | { ok: false; error: string; status: number }> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      error: "CLAUDE_API_KEY isn't set. Add it to .env.local and restart the dev server.",
    };
  }

  const prompt = buildPrompt(trade, result, rationale);
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
    return { ok: false, status: 502, error: `Claude API error: ${message.slice(0, 300)}` };
  }

  if (response.stop_reason === "refusal") {
    return {
      ok: false,
      status: 502,
      error: "Claude declined to review this trade — try again.",
    };
  }

  const textBlock = response.content.find((b) => b.type === "text");
  const content = textBlock?.text;
  if (!content) {
    return { ok: false, status: 502, error: "Claude returned an empty response — try again." };
  }

  return {
    ok: true,
    review: { content: content.trim(), createdAt: new Date().toISOString() },
  };
}
