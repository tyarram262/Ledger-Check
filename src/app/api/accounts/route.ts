import { NextResponse } from "next/server";
import { createAccount, listAccounts } from "@/lib/queries";
import type { AccountType } from "@/lib/types";

const ACCOUNT_TYPES: AccountType[] = ["taxable", "roth", "traditional_ira"];

export async function GET() {
  return NextResponse.json(listAccounts());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const type = body?.type as AccountType;

  if (!name || !ACCOUNT_TYPES.includes(type)) {
    return NextResponse.json(
      { error: "Requires name and type (taxable | roth | traditional_ira)." },
      { status: 400 }
    );
  }
  return NextResponse.json(createAccount(name, type), { status: 201 });
}
