import { describe, expect, it } from "vitest";
import { resolveAccountId } from "@/lib/accounts";

describe("resolveAccountId", () => {
  it("returns 0 when there are no accounts", () => {
    expect(resolveAccountId([], 0)).toBe(0);
  });

  it("falls back to the first account when the selected id no longer exists", () => {
    const accounts = [{ id: 5 }, { id: 6 }];
    // Simulates a picker whose state was seeded at 0 before any account
    // existed, and the fresh-refresh case where the previously selected id
    // was deleted out from under it.
    expect(resolveAccountId(accounts, 0)).toBe(5);
    expect(resolveAccountId(accounts, 999)).toBe(5);
  });

  it("keeps the selected id when it's still present in the list", () => {
    const accounts = [{ id: 5 }, { id: 6 }];
    expect(resolveAccountId(accounts, 6)).toBe(6);
  });
});
