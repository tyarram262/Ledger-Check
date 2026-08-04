import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Exchanges the magic-link token hash for a session (PKCE-style flow —
 *  see the Magic Link email template, which points here instead of using
 *  Supabase's default implicit-flow confirmation URL). */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const code = searchParams.get("code");
  const type = searchParams.get("type") as EmailOtpType | null;
  const upstreamErrorCode = searchParams.get("error_code");

  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = "/";
  redirectTo.search = "";

  const supabase = await createClient();

  // Preferred flow for our email templates.
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(redirectTo);
    }
  }

  // Fallback for links that use Supabase's code-based callback format.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(redirectTo);
    }
  }

  // If a one-time token was already consumed (for example by a link scanner)
  // but a session already exists in this browser, treat it as success.
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) {
    return NextResponse.redirect(redirectTo);
  }

  redirectTo.pathname = "/login";
  redirectTo.search = "";
  redirectTo.searchParams.set(
    "error",
    upstreamErrorCode === "otp_expired" ? "otp_expired" : "1"
  );
  return NextResponse.redirect(redirectTo);
}
