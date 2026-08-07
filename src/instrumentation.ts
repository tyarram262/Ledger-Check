import * as Sentry from "@sentry/nextjs";

/**
 * Next 16's server instrumentation hook (verified against
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md
 * — `register()` runs once before the server accepts requests, and can be
 * async; `onRequestError` must be exported directly, not called from
 * inside `register()`). `register()` dynamically imports the matching
 * runtime config (server vs. edge) rather than importing both statically,
 * so the edge bundle never pulls in Node-only server config.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/** No-ops when NEXT_PUBLIC_SENTRY_DSN is unset — Sentry.captureRequestError
 *  is safe to export unconditionally; it's a no-op if Sentry.init was never
 *  called (see sentry.server.config.ts / sentry.edge.config.ts's DSN gate). */
export const onRequestError = Sentry.captureRequestError;
