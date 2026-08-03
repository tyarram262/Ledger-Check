import { NextResponse } from "next/server";
import { parseTradeBody, runSimulation } from "@/lib/tradeContext";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = parseTradeBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.errors.join(" ") }, { status: 400 });
  }

  const outcome = await runSimulation(parsed.trade);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: 400 });
  }
  return NextResponse.json(outcome.result);
}
