import { describe, expect, it } from "vitest";
import {
  addDays,
  dayIndexInWeek,
  daysBetween,
  endOfDay,
  endOfWeek,
  formatWeekRange,
  hourOfDay,
  startOfDay,
  startOfWeek,
} from "./date";

describe("startOfDay", () => {
  it("zeroes out hour/minute/second/ms", () => {
    const d = new Date(2026, 4, 11, 13, 47, 22, 500);
    const s = startOfDay(d);
    expect(s.getHours()).toBe(0);
    expect(s.getMinutes()).toBe(0);
    expect(s.getSeconds()).toBe(0);
    expect(s.getMilliseconds()).toBe(0);
    expect(s.getDate()).toBe(11);
  });
});

describe("startOfWeek (ISO 8601, Monday-first)", () => {
  it("Monday returns same day at 00:00", () => {
    const d = new Date(2026, 4, 11, 13, 0); // Mon May 11 2026
    expect(startOfWeek(d).getDay()).toBe(1);
    expect(startOfWeek(d).getDate()).toBe(11);
  });

  it("Sunday rolls back 6 days to previous Monday", () => {
    const d = new Date(2026, 4, 17, 22, 0); // Sun May 17 2026
    const s = startOfWeek(d);
    expect(s.getDay()).toBe(1);
    expect(s.getDate()).toBe(11);
  });

  it("Wednesday rolls back to Monday of same week", () => {
    const d = new Date(2026, 4, 13, 9, 0); // Wed May 13 2026
    const s = startOfWeek(d);
    expect(s.getDate()).toBe(11);
  });

  it("crossing month boundary works (Tue Jun 2 → Mon Jun 1)", () => {
    const d = new Date(2026, 5, 2, 12, 0); // Tue Jun 2 2026
    const s = startOfWeek(d);
    expect(s.getMonth()).toBe(5);
    expect(s.getDate()).toBe(1);
  });
});

describe("addDays", () => {
  it("forward", () => {
    expect(addDays(new Date(2026, 4, 11), 3).getDate()).toBe(14);
  });
  it("backward", () => {
    expect(addDays(new Date(2026, 4, 11), -5).getDate()).toBe(6);
  });
  it("crosses month boundary forward", () => {
    const d = addDays(new Date(2026, 4, 30), 3);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(2);
  });
});

describe("endOfWeek", () => {
  it("returns Monday of next week (exclusive)", () => {
    const start = new Date(2026, 4, 11); // Mon
    const end = endOfWeek(start);
    expect(end.getDay()).toBe(1);
    expect(end.getDate()).toBe(18);
  });
});

describe("endOfDay", () => {
  it("returns next day at 00:00 (exclusive)", () => {
    const d = new Date(2026, 4, 11, 13, 47);
    const e = endOfDay(d);
    expect(e.getDate()).toBe(12);
    expect(e.getHours()).toBe(0);
  });
});

describe("daysBetween", () => {
  it("returns 7 between adjacent weeks", () => {
    const a = new Date(2026, 4, 18);
    const b = new Date(2026, 4, 11);
    expect(daysBetween(a, b)).toBe(7);
  });
});

describe("dayIndexInWeek", () => {
  const monday = new Date(2026, 4, 11).getTime();
  it("Monday 09:00 → 0", () => {
    expect(dayIndexInWeek(monday, new Date(2026, 4, 11, 9, 0).getTime())).toBe(
      0,
    );
  });
  it("Sunday 23:00 → 6", () => {
    expect(dayIndexInWeek(monday, new Date(2026, 4, 17, 23, 0).getTime())).toBe(
      6,
    );
  });
  it("outside the week (next Monday 00:00) → -1", () => {
    expect(dayIndexInWeek(monday, new Date(2026, 4, 18, 0, 0).getTime())).toBe(
      -1,
    );
  });
  it("outside the week (previous Sunday 23:59) → -1", () => {
    expect(
      dayIndexInWeek(monday, new Date(2026, 4, 10, 23, 59).getTime()),
    ).toBe(-1);
  });
});

describe("hourOfDay", () => {
  it("09:30 → 9.5", () => {
    const ts = new Date(2026, 4, 11, 9, 30).getTime();
    expect(hourOfDay(ts)).toBe(9.5);
  });
  it("00:00 → 0", () => {
    const ts = new Date(2026, 4, 11, 0, 0).getTime();
    expect(hourOfDay(ts)).toBe(0);
  });
});

describe("formatWeekRange", () => {
  it("same month: '11 - 17 May 2026'", () => {
    const out = formatWeekRange(new Date(2026, 4, 11), "en");
    expect(out).toMatch(/11 .* 17 May 2026/);
  });
  it("cross month: '29 Apr - 5 May 2026'", () => {
    const out = formatWeekRange(new Date(2026, 3, 29), "en");
    expect(out).toMatch(/29 Apr .* 5 May 2026/);
  });
  it("Turkish locale uses TR month names", () => {
    const out = formatWeekRange(new Date(2026, 4, 11), "tr");
    expect(out).toMatch(/May/);
    expect(out).toContain("11");
    expect(out).toContain("17");
  });
});
