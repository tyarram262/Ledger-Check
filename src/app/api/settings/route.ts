import { NextResponse } from "next/server";
import {
  getConcentrationThreshold,
  setConcentrationThreshold,
} from "@/lib/queries";

export async function GET() {
  return NextResponse.json({
    concentrationThreshold: await getConcentrationThreshold(),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const value = Number(body?.concentrationThreshold);

  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    return NextResponse.json(
      { error: "Threshold must be a number between 0 and 100." },
      { status: 400 }
    );
  }
  await setConcentrationThreshold(value);
  return NextResponse.json({ concentrationThreshold: value });
}
