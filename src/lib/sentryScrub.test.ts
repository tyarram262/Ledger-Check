import { describe, expect, it } from "vitest";
import { scrubSentryEvent } from "@/lib/sentryScrub";

describe("scrubSentryEvent", () => {
  it("redacts a SnapTrade user_secret regardless of nesting depth", () => {
    const event = {
      extra: { creds: { userSecret: "top-secret-value", externalUserId: "u1" } },
    };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.extra.creds.userSecret).toBe("[Redacted]");
    expect(scrubbed.extra.creds.externalUserId).toBe("u1");
  });

  it("redacts every env-var-shaped secret this app actually uses", () => {
    const event = {
      extra: {
        SNAPTRADE_CONSUMER_KEY: "ck-123",
        SNAPTRADE_CLIENT_ID: "client-abc",
        BROKERAGE_TOKEN_ENCRYPTION_KEY: "base64key==",
        CLAUDE_API_KEY: "sk-ant-123",
      },
    };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.extra.SNAPTRADE_CONSUMER_KEY).toBe("[Redacted]");
    expect(scrubbed.extra.SNAPTRADE_CLIENT_ID).toBe("[Redacted]");
    expect(scrubbed.extra.BROKERAGE_TOKEN_ENCRYPTION_KEY).toBe("[Redacted]");
    expect(scrubbed.extra.CLAUDE_API_KEY).toBe("[Redacted]");
  });

  it("redacts Cookie and Authorization request headers", () => {
    const event = {
      request: {
        url: "https://ledger-check-henna.vercel.app/simulate",
        headers: { Cookie: "sb-access-token=abc", Authorization: "Bearer xyz", "User-Agent": "test" },
      },
    };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.request.headers.Cookie).toBe("[Redacted]");
    expect(scrubbed.request.headers.Authorization).toBe("[Redacted]");
    expect(scrubbed.request.headers["User-Agent"]).toBe("test");
  });

  it("strips the token_hash query string from an /auth/confirm URL but keeps the path", () => {
    const event = {
      request: {
        url: "https://ledger-check-henna.vercel.app/auth/confirm?token_hash=abc123&type=email",
      },
    };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.request.url).toBe("https://ledger-check-henna.vercel.app/auth/confirm");
  });

  it("leaves a non-auth-confirm URL's query string untouched", () => {
    const event = { request: { url: "https://example.com/simulate?ticker=NVDA" } };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.request.url).toBe("https://example.com/simulate?ticker=NVDA");
  });

  it("redacts an email address embedded in a message body", () => {
    const event = { message: "Failed to send magic link to tanush.yarram@gmail.com" };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.message).toBe("Failed to send magic link to [redacted-email]");
  });

  it("leaves ordinary, non-sensitive fields untouched", () => {
    const event = {
      extra: { ticker: "NVDA", external_key: "activity-123", shares: 40 },
    };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.extra).toEqual({ ticker: "NVDA", external_key: "activity-123", shares: 40 });
  });

  it("does not infinite-loop on a circular reference", () => {
    const event: Record<string, unknown> = { extra: {} };
    (event.extra as Record<string, unknown>).self = event;
    expect(() => scrubSentryEvent(event)).not.toThrow();
  });

  it("passes through null and undefined unchanged", () => {
    expect(scrubSentryEvent(null)).toBeNull();
    expect(scrubSentryEvent(undefined)).toBeUndefined();
  });
});
