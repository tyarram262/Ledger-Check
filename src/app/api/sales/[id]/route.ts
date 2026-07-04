import { NextResponse } from "next/server";
import { deleteSale } from "@/lib/queries";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleted = deleteSale(Number(id));
  if (!deleted) {
    return NextResponse.json({ error: "Sale not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
