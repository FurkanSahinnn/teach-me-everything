import { describe, expect, it } from "vitest";

import { formatCompactNumber, formatUsd, niceTicks } from "./usage-format";

describe("formatCompactNumber", () => {
  it("keeps small numbers whole and compacts large ones with three significant digits", () => {
    expect(formatCompactNumber(0)).toBe("0");
    expect(formatCompactNumber(980)).toBe("980");
    expect(formatCompactNumber(7_640_000)).toBe("7.64M");
    expect(formatCompactNumber(25_800_000)).toBe("25.8M");
    expect(formatCompactNumber(122_000_000)).toBe("122M");
    expect(formatCompactNumber(5_980_000_000)).toBe("5.98B");
    expect(formatCompactNumber(1_500)).toBe("1.5K");
  });
});

describe("formatUsd", () => {
  it("uses cents for normal amounts and more precision below one cent", () => {
    expect(formatUsd(2614.7)).toBe("$2,614.70");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0042)).toBe("$0.0042");
  });
});

describe("niceTicks", () => {
  it("returns round ticks from zero that cover the max", () => {
    expect(niceTicks(630_000_000, 4)).toEqual([0, 200_000_000, 400_000_000, 600_000_000, 800_000_000]);
    expect(niceTicks(257, 4)).toEqual([0, 100, 200, 300]);
  });

  it("returns a single zero tick for an empty series", () => {
    expect(niceTicks(0, 4)).toEqual([0, 1]);
  });
});
