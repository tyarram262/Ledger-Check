import { NextResponse } from "next/server";
import { createSale, listAccounts, listSales } from "@/lib/queries";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  return NextResponse.json(await listSales());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const accountId = Number(body?.accountId);
  const ticker = typeof body?.ticker === "string" ? body.ticker.trim() : "";
  const shares = Number(body?.shares);
  const salePricePerShare = Number(body?.salePricePerShare);
  const costPerShare = Number(body?.costPerShare);
  const saleDate = body?.saleDate;

  const errors: string[] = [];
  if (!(await listAccounts()).some((a) => a.id === accountId))
    errors.push("Unknown account.");
  if (!/^[A-Za-z.\-]{1,10}$/.test(ticker)) errors.push("Invalid ticker.");
  if (!Number.isFinite(shares) || shares <= 0)
    errors.push("Shares must be a positive number.");
  if (!Number.isFinite(salePricePerShare) || salePricePerShare < 0)
    errors.push("Sale price must be zero or more.");
  if (!Number.isFinite(costPerShare) || costPerShare < 0)
    errors.push("Cost per share must be zero or more.");
  if (typeof saleDate !== "string" || !ISO_DATE.test(saleDate))
    errors.push("Sale date must be YYYY-MM-DD.");

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  }

  const id = await createSale({
    accountId,
    ticker,
    shares,
    salePricePerShare,
    costPerShare,
    saleDate,
  });
  return NextResponse.json({ id }, { status: 201 });
}
