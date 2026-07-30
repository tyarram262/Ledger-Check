"use server";

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

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) {
    return { error: error.message };
  }
  return { sent: true };
}
