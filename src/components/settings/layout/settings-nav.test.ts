import { describe, expect, it } from "vitest";

import {
  SETTINGS_SECTIONS,
  filterSettingsSections,
  resolveLegacySettingsHash,
  settingsSectionForPath,
} from "./settings-nav";

describe("settingsSectionForPath", () => {
  it("treats the settings root as the general section", () => {
    expect(settingsSectionForPath("/settings").id).toBe("general");
    expect(settingsSectionForPath("/settings/").id).toBe("general");
  });

  it("finds a section by its path, with or without a trailing slash", () => {
    expect(settingsSectionForPath("/settings/providers").id).toBe("providers");
    expect(settingsSectionForPath("/settings/usage/").id).toBe("usage");
  });

  it("falls back to general for an unknown section", () => {
    expect(settingsSectionForPath("/settings/nope").id).toBe("general");
  });
});

describe("resolveLegacySettingsHash", () => {
  it("maps the old tab hashes onto the new section routes", () => {
    expect(resolveLegacySettingsHash("#api")).toBe("/settings/providers");
    expect(resolveLegacySettingsHash("#models")).toBe("/settings/models");
    expect(resolveLegacySettingsHash("#embed")).toBe("/settings/embedding");
    expect(resolveLegacySettingsHash("#concepts")).toBe("/settings/concepts");
    expect(resolveLegacySettingsHash("#preferences")).toBe("/settings");
    expect(resolveLegacySettingsHash("#cost")).toBe("/settings/usage");
    expect(resolveLegacySettingsHash("#learning")).toBe("/settings/learning");
    expect(resolveLegacySettingsHash("#data")).toBe("/settings/data");
    expect(resolveLegacySettingsHash("#about")).toBe("/settings/about");
  });

  it("returns null for an empty or unknown hash", () => {
    expect(resolveLegacySettingsHash("")).toBeNull();
    expect(resolveLegacySettingsHash("#")).toBeNull();
    expect(resolveLegacySettingsHash("#whatever")).toBeNull();
  });
});

describe("filterSettingsSections", () => {
  const labelOf = (id: string) => id;

  it("returns every section for an empty query", () => {
    expect(filterSettingsSections("  ", labelOf)).toHaveLength(SETTINGS_SECTIONS.length);
  });

  it("matches labels and keywords case-insensitively in Turkish and English", () => {
    const ids = (q: string) => filterSettingsSections(q, labelOf).map((s) => s.id);
    expect(ids("CODEX")).toContain("providers");
    expect(ids("anahtar")).toContain("providers");
    expect(ids("tema")).toContain("appearance");
    expect(ids("limit")).toContain("usage");
  });
});

describe("SETTINGS_SECTIONS", () => {
  it("gives every section a unique id and an href under /settings", () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SETTINGS_SECTIONS) {
      expect(s.href === "/settings" || s.href.startsWith("/settings/")).toBe(true);
    }
  });
});
