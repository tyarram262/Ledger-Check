import { NextResponse } from "next/server";
import { disconnectConnection } from "@/lib/brokerage/sync";
import { requireSnapTradeConfigured, brokerageError } from "@/app/api/brokerage/_respond";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireSnapTradeConfigured();
  if (guard) return guard;

  const { id } = await params;
  const connectionId = Number(id);
  if (!Number.isInteger(connectionId)) {
    return NextResponse.json({ error: "Invalid connection id." }, { status: 400 });
  }

  try {
    await disconnectConnection(connectionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return brokerageError(err, 400, "Failed to disconnect that brokerage connection.");
  }
}
