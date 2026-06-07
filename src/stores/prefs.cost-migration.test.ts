/**
 * Phase 6.9.5 — `costPrefs.autoEmbedCap` migration.
 *
 * v15 stores have no `costPrefs` field. The v15→v16 patch must drop the
 * default cap onto every upgrading payload, and a hand-edited negative
 * value (which would flip the cost guard from "skip on too-expensive" to
 * "skip on cheap-or-free") must be clamped to zero.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_COST_PREFS, migratePrefs, type CostPrefs } from "./prefs";

const V15_BASE = {
  theme: "white",
  themeFollowsSystem: false,
  density: "normal",
  locale: "tr",
  preferredAnthropicAuth: "oauth",
  strictAnthropicAuth: false,
  aiResponseLocale: "follow_source",
  customEndpoints: [],
  notesUi: { expandedFolders: [], dailyTemplate: "", dailyFolderName: "" },
};

describe("migratePrefs v15 → v16 (costPrefs)", () => {
  it("seeds DEFAULT_COST_PREFS when costPrefs is absent", () => {
    const out = migratePrefs({ ...V15_BASE }, 15) as { costPrefs: CostPrefs };
    expect(out.costPrefs).toEqual(DEFAULT_COST_PREFS);
    expect(out.costPrefs.autoEmbedCap).toBe(0.1);
  });

  it("keeps a valid pre-set value untouched", () => {
    const custom: CostPrefs = { autoEmbedCap: 0.5 };
    const out = migratePrefs(
      { ...V15_BASE, costPrefs: custom },
      15,
    ) as { costPrefs: CostPrefs };
    expect(out.costPrefs.autoEmbedCap).toBe(0.5);
  });

  it("clamps a negative autoEmbedCap to zero (defensive)", () => {
    const out = migratePrefs(
      { ...V15_BASE, costPrefs: { autoEmbedCap: -1 } },
      15,
    ) as { costPrefs: CostPrefs };
    expect(out.costPrefs.autoEmbedCap).toBe(0);
  });

  it("resets when costPrefs is the wrong shape (non-finite, missing field)", () => {
    const cases: unknown[] = [
      "nope",
      42,
      [],
      { autoEmbedCap: "0.10" },
      { autoEmbedCap: Number.NaN },
      { autoEmbedCap: Number.POSITIVE_INFINITY },
      { other: 1 },
    ];
    for (const bad of cases) {
      const out = migratePrefs(
        { ...V15_BASE, costPrefs: bad },
        15,
      ) as { costPrefs: CostPrefs };
      expect(out.costPrefs).toEqual(DEFAULT_COST_PREFS);
    }
  });
});
