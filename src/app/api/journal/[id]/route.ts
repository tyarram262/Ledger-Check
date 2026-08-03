import { NextResponse } from "next/server";
import { deleteJournalEntry } from "@/lib/queries";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleted = await deleteJournalEntry(Number(id));
  if (!deleted) {
    return NextResponse.json({ error: "Journal entry not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
