import { NextResponse } from "next/server";
import { parseHoldingsCsv } from "@/lib/csvImport";
import { createLot, listAccounts } from "@/lib/queries";
import { getDb } from "@/lib/db";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const accountId = Number(body?.accountId);
  const csv = typeof body?.csv === "string" ? body.csv : "";

  if (!listAccounts().some((a) => a.id === accountId)) {
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

  const db = getDb();
  db.exec("BEGIN");
  try {
    for (const lot of lots) {
      createLot({ accountId, ...lot });
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json(
    { imported: lots.length, rowErrors: errors },
    { status: 201 }
  );
}
