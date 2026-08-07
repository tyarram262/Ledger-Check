/**
 * `beforeSend`/`beforeSendTransaction` hook shared by every Sentry runtime
 * config (server/edge/client) — see sentry.server.config.ts,
 * sentry.edge.config.ts, src/instrumentation-client.ts. This app stores
 * encrypted brokerage credentials (`snaptrade_users.user_secret`) and real
 * financial data; an error captured with those attached would leak them to
 * a third party regardless of the app's own encryption. `sendDefaultPii:
 * false` in each config already keeps Sentry from collecting IP/cookies by
 * default — this is the second, independent layer for anything an error's
 * own payload happens to carry (a thrown Error whose message embeds a
 * request body, a breadcrumb capturing a fetch URL, etc).
 *
 * Deliberately over-redacts rather than under-redacts: a field name that
 * merely looks secret-shaped (e.g. `external_key`, SnapTrade's own
 * activity-id field) is not itself sensitive, but this errs toward losing
 * debug context rather than risking a real leak.
 */

const SECRET_KEY_PATTERN =
  /secret|token|password|api[_-]?key|encryption|authoriz|cookie|consumer[_-]?key|client[_-]?id/i;

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * `/auth/confirm` URLs carry a live `token_hash` magic-link query param
 * (see CLAUDE.md's Auth flow section) — a captured error URL containing one
 * would hand Sentry a working sign-in link. Strip the query string, keep
 * the path.
 */
function stripAuthConfirmQuery(value: string): string {
  const idx = value.indexOf("/auth/confirm");
  if (idx === -1) return value;
  const queryIdx = value.indexOf("?", idx);
  return queryIdx === -1 ? value : value.slice(0, queryIdx);
}

function scrubString(value: string): string {
  return stripAuthConfirmQuery(value).replace(EMAIL_PATTERN, "[redacted-email]");
}

function scrubDeep(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, seen));

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? "[Redacted]" : scrubDeep(v, seen);
  }
  return out;
}

/** Deep-scrubs a Sentry event (or any plain-object payload) before it
 *  leaves the process. Safe to call on `undefined`/`null` (Sentry's
 *  `beforeSend` can be asked to drop an event by returning `null`, which
 *  should pass through unchanged). */
export function scrubSentryEvent<T>(event: T): T {
  return scrubDeep(event, new WeakSet()) as T;
}
