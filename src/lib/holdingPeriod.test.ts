import { describe, expect, it } from "vitest";
import { daysUntilLongTerm, longTermOn, termFor } from "@/lib/holdingPeriod";

describe("termFor", () => {
  it("is short-term at exactly 365 days held", () => {
    expect(termFor("2025-01-01", "2026-01-01")).toBe("short");
  });

  it("is long-term at 366 days held", () => {
    expect(termFor("2025-01-01", "2026-01-02")).toBe("long");
  });

  it("is short-term for a same-day round trip", () => {
    expect(termFor("2026-06-01", "2026-06-01")).toBe("short");
  });

  it("handles a leap year without shifting the boundary", () => {
    // 2024 is a leap year (366 days), so day 365 after 2024-01-01 lands on
    // 2024-12-31 — still short-term; 2025-01-01 (day 366) is long-term.
    expect(termFor("2024-01-01", "2024-12-31")).toBe("short");
    expect(termFor("2024-01-01", "2025-01-01")).toBe("long");
  });
});

describe("longTermOn", () => {
  it("is 366 days after purchase", () => {
    expect(longTermOn("2026-04-15")).toBe("2027-04-16");
  });

  it("crosses a leap-year boundary correctly", () => {
    // 2024 is a leap year (366 days), so day 366 after 2024-01-01 lands
    // exactly on 2025-01-01, one day earlier than a non-leap year would.
    expect(longTermOn("2024-01-01")).toBe("2025-01-01");
  });
});

describe("daysUntilLongTerm", () => {
  it("counts down to the crossover date", () => {
    expect(daysUntilLongTerm("2026-04-15", "2026-08-02")).toBe(
      Math.max(0, 366 - 109) // 2026-04-15 -> 2026-08-02 is 109 days
    );
  });

  it("is 0 once the lot is already long-term", () => {
    expect(daysUntilLongTerm("2025-01-01", "2026-06-01")).toBe(0);
  });

  it("is 0 exactly on the crossover date", () => {
    expect(daysUntilLongTerm("2026-04-15", "2027-04-16")).toBe(0);
  });

  it("is 1 the day before crossover", () => {
    expect(daysUntilLongTerm("2026-04-15", "2027-04-15")).toBe(1);
  });
});
