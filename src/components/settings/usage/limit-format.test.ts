import { describe, expect, it } from "vitest";

import { formatDurationShort, limitLabel, percentLeft } from "./limit-format";

const tr = (a: string) => a;
const en = (_a: string, b: string) => b;
const MIN = 60_000;

describe("formatDurationShort", () => {
  it("uses days and hours for long spans", () => {
    expect(formatDurationShort(5 * 1440 * MIN + 11 * 60 * MIN, en)).toBe("5d 11h");
    expect(formatDurationShort(5 * 1440 * MIN + 11 * 60 * MIN, tr)).toBe("5g 11sa");
  });

  it("uses hours and minutes under a day", () => {
    expect(formatDurationShort(4 * 60 * MIN + 59 * MIN, en)).toBe("4h 59m");
  });

  it("uses minutes under an hour and never goes below one minute", () => {
    expect(formatDurationShort(42 * MIN, en)).toBe("42m");
    expect(formatDurationShort(10_000, en)).toBe("1m");
  });

  it("returns null for a past or missing time", () => {
    expect(formatDurationShort(-5, en)).toBeNull();
    expect(formatDurationShort(Number.NaN, en)).toBeNull();
  });
});

describe("percentLeft", () => {
  it("is 100 minus used, rounded and clamped", () => {
    expect(percentLeft(34.4)).toBe(66);
    expect(percentLeft(120)).toBe(0);
    expect(percentLeft(-3)).toBe(100);
  });
});

describe("limitLabel", () => {
  it("localizes the window kind and keeps the model name", () => {
    expect(limitLabel({ kind: "session" }, en)).toBe("Session");
    expect(limitLabel({ kind: "weekly" }, tr)).toBe("Haftalık");
    expect(limitLabel({ kind: "weekly_model", modelName: "Fable" }, en)).toBe("Weekly · Fable");
    expect(limitLabel({ kind: "monthly" }, en)).toBe("Monthly credit");
  });
});
