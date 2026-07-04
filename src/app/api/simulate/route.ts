import { NextResponse } from "next/server";
import { listLots, listSales } from "@/lib/queries";
import { simulateTrade } from "@/lib/simulate";
import { todayIso } from "@/lib/dates";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const side = body?.side;
  const ticker = typeof body?.ticker === "string" ? body.ticker.trim() : "";
  const shares = Number(body?.shares);
  const pricePerShare = Number(body?.pricePerShare);
  const accountId = body?.accountId ? Number(body.accountId) : undefined;

  const errors: string[] = [];
  if (side !== "buy" && side !== "sell") errors.push("Side must be buy or sell.");
  if (!/^[A-Za-z.\-]{1,10}$/.test(ticker)) errors.push("Invalid ticker.");
  if (!Number.isFinite(shares) || shares <= 0)
    errors.push("Shares must be a positive number.");
  if (!Number.isFinite(pricePerShare) || pricePerShare <= 0)
    errors.push("Price must be a positive number.");
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  }

  const outcome = simulateTrade(
    { side, ticker, shares, pricePerShare, accountId },
    listLots(),
    listSales(),
    todayIso()
  );
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: 400 });
  }
  return NextResponse.json(outcome.result);
}
