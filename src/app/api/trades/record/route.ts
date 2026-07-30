import { NextResponse } from "next/server";
import { listAccounts } from "@/lib/queries";
import { recordTrade } from "@/lib/recordTrade";
import { todayIso } from "@/lib/dates";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const side = body?.side;
  const ticker = typeof body?.ticker === "string" ? body.ticker.trim() : "";
  const shares = Number(body?.shares);
  const pricePerShare = Number(body?.pricePerShare);
  const accountId = Number(body?.accountId);

  const errors: string[] = [];
  if (side !== "buy" && side !== "sell") errors.push("Side must be buy or sell.");
  if (!/^[A-Za-z.\-]{1,10}$/.test(ticker)) errors.push("Invalid ticker.");
  if (!Number.isFinite(shares) || shares <= 0)
    errors.push("Shares must be a positive number.");
  if (!Number.isFinite(pricePerShare) || pricePerShare <= 0)
    errors.push("Price must be a positive number.");
  if (!(await listAccounts()).some((a) => a.id === accountId))
    errors.push("Unknown account.");
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  }

  const outcome = await recordTrade(
    { side, ticker, shares, pricePerShare, accountId },
    todayIso()
  );
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
