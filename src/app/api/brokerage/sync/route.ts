import { NextResponse } from "next/server";
import { syncAccounts } from "@/lib/brokerage/sync";
import { requireSnapTradeConfigured, brokerageError } from "@/app/api/brokerage/_respond";

export async function POST(request: Request) {
  const guard = requireSnapTradeConfigured();
  if (guard) return guard;

  const body = await request.json().catch(() => ({}));
  const accountId = body?.accountId !== undefined ? Number(body.accountId) : undefined;
  if (accountId !== undefined && !Number.isFinite(accountId)) {
    return NextResponse.json({ error: "accountId must be a number." }, { status: 400 });
  }

  try {
    const summaries = await syncAccounts(accountId);
    return NextResponse.json({ summaries });
  } catch (err) {
    return brokerageError(err, 502, "Sync failed.");
  }
}
