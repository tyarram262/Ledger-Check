import { NextResponse } from "next/server";
import { updateAccountCash } from "@/lib/queries";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const cashBalance = Number(body?.cashBalance);

  if (!Number.isFinite(cashBalance) || cashBalance < 0) {
    return NextResponse.json(
      { error: "cashBalance must be a non-negative number." },
      { status: 400 }
    );
  }

  const updated = await updateAccountCash(Number(id), cashBalance);
  if (!updated) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
