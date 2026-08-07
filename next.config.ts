import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

// Source-map upload needs SENTRY_AUTH_TOKEN, which doesn't exist yet (Sentry
// is currently un-configured — see sentry.server.config.ts's DSN gate). Disable
// upload explicitly rather than letting the plugin fail/warn on a missing
// token, so `next build` stays clean either way.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
