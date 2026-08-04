import { NextResponse } from "next/server";
import { startConnection } from "@/lib/brokerage/sync";
import { requireSnapTradeConfigured, brokerageError } from "@/app/api/brokerage/_respond";

export async function POST(request: Request) {
  const guard = requireSnapTradeConfigured();
  if (guard) return guard;

  // Same origin-derivation approach as the magic-link sign-in
  // (`login/actions.ts`) — send the user back to whichever origin they're
  // on (localhost in dev, the deployed domain in prod) rather than a
  // fixed URL.
  const origin = request.headers.get("origin");
  if (!origin) {
    return NextResponse.json({ error: "Could not determine the redirect origin." }, { status: 400 });
  }

  try {
    const url = await startConnection(`${origin}/holdings?connected=1`);
    return NextResponse.json({ url });
  } catch (err) {
    return brokerageError(err, 502, "Failed to start the brokerage connection.");
  }
}
