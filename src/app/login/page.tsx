"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { login, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    login,
    undefined
  );
  const searchParams = useSearchParams();
  const authError = searchParams.get("error");
  const linkExpired = authError === "1" || authError === "otp_expired";

  if (state?.sent) {
    return (
      <div className="mx-auto max-w-sm py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Check your email
        </h1>
        <p className="mt-3 text-sm text-slate-500">
          We sent you a sign-in link. Open it on this device to continue.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-center text-2xl font-semibold tracking-tight">
        Sign in to Ledger Check
      </h1>
      <p className="mt-2 text-center text-sm text-slate-500">
        Enter your email and we&apos;ll send you a one-time sign-in link — no
        password needed.
      </p>
      <form action={action} className="mt-6 space-y-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Email</span>
          <input
            name="email"
            type="email"
            required
            autoFocus
            placeholder="you@example.com"
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
        {linkExpired && !state?.error && (
          <p className="text-sm text-red-600">
            {authError === "otp_expired"
              ? "That sign-in link was already consumed or expired before it reached this browser. Request a fresh link and open only the newest email."
              : "That link expired or was already used — request a new one below."}
          </p>
        )}
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send magic link"}
        </button>
      </form>
    </div>
  );
}
