import { NextResponse } from "next/server";
import { discoverAccounts } from "@/lib/brokerage/sync";
import { requireSnapTradeConfigured, brokerageError } from "@/app/api/brokerage/_respond";

export async function GET() {
  const guard = requireSnapTradeConfigured();
  if (guard) return guard;

  try {
    return NextResponse.json(await discoverAccounts());
  } catch (err) {
    return brokerageError(err, 502, "Failed to list brokerage accounts.");
  }
}
