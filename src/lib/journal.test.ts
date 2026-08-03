import { describe, expect, it } from "vitest";
import { horizonLabel, horizonReviewDate, isPastHorizon, type JournalEntry } from "@/lib/journal";

function makeEntry(over: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 1,
    lotId: 10,
    ticker: "AAPL",
    accountId: 1,
    shares: 10,
    costPerShare: 150,
    purchaseDate: "2026-01-15",
    reason: "Long-term growth conviction",
    timeHorizon: "1_3y",
    horizonReviewDate: horizonReviewDate("2026-01-15", "1_3y"),
    sellTrigger: null,
    risks: null,
    aiReview: null,
    source: "manual",
    createdAt: "2026-01-15T00:00:00.000Z",
    ...over,
  };
}

describe("horizonReviewDate", () => {
  it("adds 12 months for under_1y", () => {
    expect(horizonReviewDate("2026-01-15", "under_1y")).toBe("2027-01-15");
  });

  it("adds 36 months for 1_3y", () => {
    expect(horizonReviewDate("2026-01-15", "1_3y")).toBe("2029-01-15");
  });

  it("floors 10y_plus at 120 months", () => {
    expect(horizonReviewDate("2026-08-02", "10y_plus")).toBe("2036-08-02");
  });

  it("returns null for an indefinite horizon", () => {
    expect(horizonReviewDate("2026-01-15", "indefinite")).toBeNull();
  });

  it("clamps across a leap-year month-end boundary", () => {
    // 2024-01-31 + 1 month (under_1y math reused via addMonths) clamps to
    // Feb 29 on the leap year, not overflowing into March.
    expect(horizonReviewDate("2023-01-31", "under_1y")).toBe("2024-01-31");
  });
});

describe("isPastHorizon", () => {
  it("is false before the review date", () => {
    const entry = makeEntry({ horizonReviewDate: "2029-01-15" });
    expect(isPastHorizon(entry, "2026-08-02")).toBe(false);
  });

  it("is true exactly on the review date", () => {
    const entry = makeEntry({ horizonReviewDate: "2026-08-02" });
    expect(isPastHorizon(entry, "2026-08-02")).toBe(true);
  });

  it("is true after the review date", () => {
    const entry = makeEntry({ horizonReviewDate: "2020-01-01" });
    expect(isPastHorizon(entry, "2026-08-02")).toBe(true);
  });

  it("is always false for an indefinite horizon (no review date)", () => {
    const entry = makeEntry({ timeHorizon: "indefinite", horizonReviewDate: null });
    expect(isPastHorizon(entry, "2099-01-01")).toBe(false);
  });
});

describe("horizonLabel", () => {
  it("returns the human-readable label for each horizon", () => {
    expect(horizonLabel("under_1y")).toBe("Less than a year");
    expect(horizonLabel("10y_plus")).toBe("10+ years");
    expect(horizonLabel("indefinite")).toBe("No set horizon");
  });
});
