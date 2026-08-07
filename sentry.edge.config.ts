import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentryScrub";

/** Edge runtime counterpart of sentry.server.config.ts — covers src/proxy.ts
 *  (Next 16's renamed middleware, see CLAUDE.md) and any edge route
 *  handlers. Same DSN gate and PII scrubbing as the server config. */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}
