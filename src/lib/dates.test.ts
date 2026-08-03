import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween } from "@/lib/dates";

describe("addDays", () => {
  it("crosses month boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("crosses year boundaries", () => {
    expect(addDays("2025-12-25", 10)).toBe("2026-01-04");
  });

  it("handles leap years", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("computes the 31-day wash-sale clear date", () => {
    expect(addDays("2026-06-23", 31)).toBe("2026-07-24");
  });
});

describe("addMonths", () => {
  it("crosses year boundaries", () => {
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("clamps to the shorter month's last day instead of overflowing", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("clamps to Feb 29 on a leap year", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("adds a decade cleanly", () => {
    expect(addMonths("2026-08-02", 120)).toBe("2036-08-02");
  });
});

describe("daysBetween", () => {
  it("is positive when `to` is later", () => {
    expect(daysBetween("2026-06-03", "2026-07-03")).toBe(30);
  });

  it("is negative when `to` is earlier", () => {
    expect(daysBetween("2026-07-03", "2026-06-30")).toBe(-3);
  });

  it("is zero for the same day", () => {
    expect(daysBetween("2026-07-03", "2026-07-03")).toBe(0);
  });
});
