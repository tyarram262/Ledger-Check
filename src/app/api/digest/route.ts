import { NextResponse } from "next/server";
import { generateDigest, getCachedDigest } from "@/lib/digest";

export async function GET() {
  return NextResponse.json({ digest: await getCachedDigest() });
}

export async function POST() {
  const outcome = await generateDigest();
  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error },
      { status: outcome.status }
    );
  }
  return NextResponse.json({ digest: outcome.digest });
}
