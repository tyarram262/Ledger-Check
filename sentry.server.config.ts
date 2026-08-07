import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentryScrub";

/**
 * Gated on NEXT_PUBLIC_SENTRY_DSN, same pattern as SnapTrade's
 * SNAPTRADE_CLIENT_ID/SNAPTRADE_CONSUMER_KEY gate (snaptrade.ts's
 * isConfigured) — absent, Sentry.init is never called and the app behaves
 * exactly as it did with no error tracking at all.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // This app stores encrypted brokerage credentials and financial data —
    // never send IP/cookies by default. beforeSend below is the second,
    // independent layer (see sentryScrub.ts).
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}
