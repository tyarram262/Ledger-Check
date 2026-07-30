"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: origin ? { emailRedirectTo: `${origin}/auth/confirm` } : undefined,
  });
  if (error) {
    return { error: error.message };
  }
  return { sent: true };
}
