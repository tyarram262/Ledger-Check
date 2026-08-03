import { NextResponse } from "next/server";
import { createJournalEntry, listJournalEntries, listLots } from "@/lib/queries";
import { TIME_HORIZONS, type TimeHorizon } from "@/lib/journal";

const REASON_MAX = 2000;
const OPTIONAL_MAX = 2000;

function trimToLength(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET() {
  return NextResponse.json(await listJournalEntries());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const lotId = Number(body?.lotId);
  const timeHorizon = body?.timeHorizon as TimeHorizon;
  const reason = trimToLength(body?.reason, REASON_MAX);

  const errors: string[] = [];
  if (!reason) errors.push("Reason is required.");
  if (!TIME_HORIZONS.some((t) => t.value === timeHorizon)) {
    errors.push("Time horizon must be one of: " + TIME_HORIZONS.map((t) => t.value).join(", ") + ".");
  }

  // Derive ticker/account/shares/cost/purchaseDate from the lot itself,
  // not the request body — the journal entry is a snapshot of a real
  // purchase the caller owns (RLS-scoped), not arbitrary client data.
  const lot = (await listLots()).find((l) => l.id === lotId);
  if (!lot) errors.push("Unknown lot.");

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  }

  const id = await createJournalEntry({
    lotId: lot!.id,
    ticker: lot!.ticker,
    accountId: lot!.accountId,
    shares: lot!.shares,
    costPerShare: lot!.costPerShare,
    purchaseDate: lot!.purchaseDate,
    reason: reason!,
    timeHorizon,
    sellTrigger: trimToLength(body?.sellTrigger, OPTIONAL_MAX),
    risks: trimToLength(body?.risks, OPTIONAL_MAX),
    aiReview: trimToLength(body?.aiReview, 4000),
    source: body?.source === "simulator" ? "simulator" : "manual",
  });
  return NextResponse.json({ id }, { status: 201 });
}
