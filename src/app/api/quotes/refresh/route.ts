import { NextResponse } from "next/server";
import { listLots } from "@/lib/queries";
import { refreshQuotes } from "@/lib/quotes";

export async function POST() {
  const tickers = [...new Set((await listLots()).map((l) => l.ticker))];
  if (tickers.length === 0) {
    return NextResponse.json({ updated: [], failed: [] });
  }
  const result = await refreshQuotes(tickers);
  return NextResponse.json(result);
}
