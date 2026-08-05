import { NextResponse } from "next/server";
import { connectionStatus } from "@/lib/brokerage/sync";
import { brokerageError } from "@/app/api/brokerage/_respond";

export async function GET() {
  try {
    return NextResponse.json(await connectionStatus());
  } catch (err) {
    return brokerageError(err, 502, "Failed to load brokerage connection status.");
  }
}
