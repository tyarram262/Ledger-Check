import { NextResponse } from "next/server";
import { linkAccount } from "@/lib/brokerage/sync";
import { requireSnapTradeConfigured, brokerageError } from "@/app/api/brokerage/_respond";
import type { AccountType } from "@/lib/types";

const ACCOUNT_TYPES: AccountType[] = ["taxable", "roth", "traditional_ira"];

export async function POST(request: Request) {
  const guard = requireSnapTradeConfigured();
  if (guard) return guard;

  const body = await request.json().catch(() => null);
  const externalAccountId = typeof body?.externalAccountId === "string" ? body.externalAccountId : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const type = body?.type as AccountType;

  if (!externalAccountId || !name || !ACCOUNT_TYPES.includes(type)) {
    return NextResponse.json(
      { error: "Requires externalAccountId, name, and type (taxable | roth | traditional_ira)." },
      { status: 400 }
    );
  }

  try {
    const accountId = await linkAccount({ externalAccountId, name, type });
    return NextResponse.json({ accountId }, { status: 201 });
  } catch (err) {
    return brokerageError(err, 400, "Failed to link the account.");
  }
}
