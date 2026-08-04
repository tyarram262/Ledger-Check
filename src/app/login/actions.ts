"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/appUrl";

export type LoginState = { error?: string; sent?: boolean } | undefined;

export async function login(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address." };
  }

  // Send the magic link back to whichever origin the user is signing in
  // from (localhost in dev, the deployed domain in prod) rather than a
  // fixed Site URL — Supabase only supports one Site URL per project.
  const origin = (await headers()).get("origin");
  const appUrl = origin && !origin.includes("localhost") ? origin : getAppUrl();

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${appUrl}/auth/confirm` },
  });
  if (error) {
    // Some failures (e.g. the SMTP provider rejecting the send) surface as
    // an AuthRetryableFetchError whose message is the literal string "{}" —
    // fall back to something readable rather than showing that verbatim.
    const message =
      error.message && error.message !== "{}"
        ? error.message
        : "Something went wrong sending the sign-in link. Please try again in a moment.";
    return { error: message };
  }
  return { sent: true };
}
