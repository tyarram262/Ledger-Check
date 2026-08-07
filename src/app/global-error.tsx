"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Root-layout error boundary — the last line of defense for a React render
 * error that escapes every nested error.tsx. Previously nothing reported
 * these at all (see CLAUDE.md: "zero error-reporting exists today").
 * Sentry.captureException is a safe no-op when NEXT_PUBLIC_SENTRY_DSN is
 * unset (see sentry.server.config.ts's DSN gate — Sentry.init was never
 * called, so there's no client to send to).
 *
 * unstable_retry (not reset) per Next 16's file convention — verified
 * against node_modules/next/dist/docs/.../error.md, which recommends it
 * over reset() for the general case (AGENTS.md: this Next.js version is
 * newer than most training data).
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    // global-error must include its own html and body tags — it replaces
    // the root layout when active.
    <html>
      <body className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Something went wrong.</h2>
          <p className="mt-2 text-sm text-slate-600">
            The error has been reported. Try again, or come back in a moment.
          </p>
          <button
            onClick={() => unstable_retry()}
            className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
