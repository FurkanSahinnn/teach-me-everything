import { describe, expect, it } from "vitest";
import { formatFullDate, formatRelativeDay } from "./intl";

const FIXED_NOW = Date.UTC(2026, 3, 29, 12, 0, 0);
const DAY = 86_400_000;

describe("formatRelativeDay", () => {
  it("formats yesterday in Turkish", () => {
    const result = formatRelativeDay(FIXED_NOW - DAY, "tr", FIXED_NOW);
    expect(result.toLowerCase()).toContain("dün");
  });

  it("formats yesterday in English", () => {
    const result = formatRelativeDay(FIXED_NOW - DAY, "en", FIXED_NOW);
    expect(result.toLowerCase()).toBe("yesterday");
  });

  it("formats 3 days from now in Turkish", () => {
    const result = formatRelativeDay(FIXED_NOW + 3 * DAY, "tr", FIXED_NOW);
    expect(result).toContain("3");
    expect(result.toLowerCase()).toContain("gün");
  });

  it("formats 3 days from now in English", () => {
    const result = formatRelativeDay(FIXED_NOW + 3 * DAY, "en", FIXED_NOW);
    expect(result.toLowerCase()).toContain("3 days");
  });

  it("formats today in Turkish", () => {
    const result = formatRelativeDay(FIXED_NOW, "tr", FIXED_NOW);
    expect(result.toLowerCase()).toContain("bugün");
  });

  it("formats today in English", () => {
    const result = formatRelativeDay(FIXED_NOW, "en", FIXED_NOW);
    expect(result.toLowerCase()).toBe("today");
  });
});

describe("formatFullDate", () => {
  it("returns Turkish-formatted full date", () => {
    const result = formatFullDate(FIXED_NOW, "tr");
    expect(result).toMatch(/2026/);
    // Turkish month for April is "Nisan"
    expect(result.toLowerCase()).toContain("nisan");
  });

  it("returns English-formatted full date", () => {
    const result = formatFullDate(FIXED_NOW, "en");
    expect(result).toMatch(/2026/);
    expect(result).toContain("April");
  });

  it("differs between en and tr formatting", () => {
    const tr = formatFullDate(FIXED_NOW, "tr");
    const en = formatFullDate(FIXED_NOW, "en");
    expect(tr).not.toBe(en);
  });
});
