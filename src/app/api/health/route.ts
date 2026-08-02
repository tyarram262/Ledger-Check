import { NextResponse } from "next/server";
import { computeAndPersistHealth } from "@/lib/health";

export async function GET() {
  return NextResponse.json(await computeAndPersistHealth());
}
