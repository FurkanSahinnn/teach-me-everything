import { describe, expect, it } from "vitest";

import { computePopoverPosition, formatCatalogRelative, providerShortLabel } from "./picker-utils";

const VIEWPORT = { width: 1440, height: 900 };

describe("computePopoverPosition", () => {
  it("opens below the trigger, right-aligned, when there is room", () => {
    const pos = computePopoverPosition({ top: 100, bottom: 140, left: 900, right: 1200 }, VIEWPORT, 560, 440);

    expect(pos).toEqual({ top: 146, left: 640, width: 560, maxHeight: 440, placement: "below" });
  });

  it("flips above when the space below is too small and there is more above", () => {
    const pos = computePopoverPosition({ top: 700, bottom: 740, left: 900, right: 1200 }, VIEWPORT, 560, 440);

    expect(pos.placement).toBe("above");
    expect(pos.top + pos.maxHeight).toBe(694);
  });

  it("keeps the panel inside a narrow viewport", () => {
    const pos = computePopoverPosition({ top: 100, bottom: 140, left: 40, right: 300 }, { width: 380, height: 800 }, 560, 440);

    expect(pos.width).toBe(356);
    expect(pos.left).toBe(12);
  });
});

describe("formatCatalogRelative", () => {
  const now = 10_000_000;

  it("uses compact units", () => {
    expect(formatCatalogRelative(now - 30_000, "en", now)).toBe("just now");
    expect(formatCatalogRelative(now - 5 * 60_000, "tr", now)).toBe("5 dk önce");
    expect(formatCatalogRelative(now - 3 * 3_600_000, "en", now)).toBe("3 h ago");
  });
});

describe("providerShortLabel", () => {
  it("drops the model part of a chat option label", () => {
    expect(providerShortLabel("Codex (local CLI) · gpt-6-astra")).toBe("Codex (local CLI)");
    expect(providerShortLabel("OpenRouter")).toBe("OpenRouter");
  });
});
