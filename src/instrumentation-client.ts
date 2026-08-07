import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentryScrub";

/**
 * Next 16's client-side instrumentation hook (verified against
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md
 * — no exported functions required, code runs directly; see AGENTS.md on
 * why this app checks the bundled docs instead of assuming). Browser
 * counterpart of sentry.server.config.ts/sentry.edge.config.ts — same DSN
 * gate, same beforeSend scrub, since a client-side error can just as
 * easily embed a request URL or response body carrying something
 * sensitive.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}

/** Required export for Next 16's onRouterTransitionStart convention (see
 *  node_modules/next/dist/docs/.../instrumentation-client.md) — no-ops like
 *  the rest of this file when Sentry.init above was never called. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
