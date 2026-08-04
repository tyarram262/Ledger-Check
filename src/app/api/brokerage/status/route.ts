import { NextResponse } from "next/server";
import { connectionStatus } from "@/lib/brokerage/sync";

export async function GET() {
  return NextResponse.json(await connectionStatus());
}
