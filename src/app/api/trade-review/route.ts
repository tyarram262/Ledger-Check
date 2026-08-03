import { NextResponse } from "next/server";
import { parseTradeBody, runSimulation } from "@/lib/tradeContext";
import { generateTradeReview, normalizeRationale } from "@/lib/tradeReview";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = parseTradeBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.errors.join(" ") }, { status: 400 });
  }

  const rationale = normalizeRationale((body as Record<string, unknown> | null)?.rationale);

  // Re-derive the simulation server-side rather than trusting a
  // client-supplied SimulationResult — not primarily an auth concern (RLS
  // already scopes everything), but prompt integrity: a client bug could
  // otherwise produce authoritative-sounding AI prose about numbers that
  // were never actually computed. Also means an invalid trade never
  // reaches (and never bills) the Claude call.
  const outcome = await runSimulation(parsed.trade);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: 400 });
  }

  const review = await generateTradeReview(parsed.trade, outcome.result, rationale);
  if (!review.ok) {
    return NextResponse.json({ error: review.error }, { status: review.status });
  }
  return NextResponse.json({ review: review.review });
}
