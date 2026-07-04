import { NextResponse } from "next/server";
import { createLot, listAccounts, listLots } from "@/lib/queries";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  return NextResponse.json(listLots());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const accountId = Number(body?.accountId);
  const ticker = typeof body?.ticker === "string" ? body.ticker.trim() : "";
  const shares = Number(body?.shares);
  const costPerShare = Number(body?.costPerShare);
  const purchaseDate = body?.purchaseDate;

  const errors: string[] = [];
  if (!listAccounts().some((a) => a.id === accountId))
    errors.push("Unknown account.");
  if (!/^[A-Za-z.\-]{1,10}$/.test(ticker)) errors.push("Invalid ticker.");
  if (!Number.isFinite(shares) || shares <= 0)
    errors.push("Shares must be a positive number.");
  if (!Number.isFinite(costPerShare) || costPerShare < 0)
    errors.push("Cost per share must be zero or more.");
  if (typeof purchaseDate !== "string" || !ISO_DATE.test(purchaseDate))
    errors.push("Purchase date must be YYYY-MM-DD.");

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  }

  const id = createLot({ accountId, ticker, shares, costPerShare, purchaseDate });
  return NextResponse.json({ id }, { status: 201 });
}
