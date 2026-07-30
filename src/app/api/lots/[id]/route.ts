import { NextResponse } from "next/server";
import { deleteLot } from "@/lib/queries";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleted = await deleteLot(Number(id));
  if (!deleted) {
    return NextResponse.json({ error: "Lot not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
