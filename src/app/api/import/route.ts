import { NextResponse } from "next/server";
import { parseHoldingsCsv } from "@/lib/csvImport";
import { bulkCreateLots, listAccounts } from "@/lib/queries";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const accountId = Number(body?.accountId);
  const csv = typeof body?.csv === "string" ? body.csv : "";

  if (!(await listAccounts()).some((a) => a.id === accountId)) {
    return NextResponse.json({ error: "Unknown account." }, { status: 400 });
  }
  if (csv.length === 0 || csv.length > 1_000_000) {
    return NextResponse.json(
      { error: "Provide a CSV file under 1 MB." },
      { status: 400 }
    );
  }

  const { lots, errors } = parseHoldingsCsv(csv);
  if (lots.length === 0) {
    return NextResponse.json(
      { error: "No importable rows found.", rowErrors: errors },
      { status: 400 }
    );
  }

  const imported = await bulkCreateLots(accountId, lots);

  return NextResponse.json({ imported, rowErrors: errors }, { status: 201 });
}
