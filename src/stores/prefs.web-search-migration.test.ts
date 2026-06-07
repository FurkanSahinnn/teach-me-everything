import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEB_SEARCH_PREFS,
  migratePrefs,
  webSearchPrefsToOptions,
  type WebSearchPrefs,
} from "./prefs";

type MigratedShape = {
  webSearchPrefs: WebSearchPrefs;
};

describe("prefs v12 migration — webSearchPrefs", () => {
  it("seeds defaults when migrating from v11 (no webSearchPrefs field)", () => {
    const v11State = {
      theme: "dark",
      density: "normal",
      modelBindings: {
        chat: "anthropic::claude-sonnet-4-6",
        summary: "anthropic::claude-sonnet-4-6",
        quick: "anthropic::claude-haiku-4-5",
        embedPresetId: "openai-3-small",
        flashcardGen: "anthropic::claude-sonnet-4-6",
        researchProvider: "readability",
      },
    };
    const next = migratePrefs(v11State, 11) as unknown as MigratedShape;
    expect(next.webSearchPrefs).toEqual(DEFAULT_WEB_SEARCH_PREFS);
  });

  it("preserves valid v12 webSearchPrefs untouched", () => {
    const v12State = {
      theme: "dark",
      webSearchPrefs: {
        enabled: true,
        maxUses: 7,
        searchMode: "deep",
        recencyDays: 30,
        allowedDomains: ["arxiv.org"],
        blockedDomains: ["spam.example"],
      },
    };
    const next = migratePrefs(v12State, 12) as unknown as MigratedShape;
    expect(next.webSearchPrefs.enabled).toBe(true);
    expect(next.webSearchPrefs.maxUses).toBe(7);
    expect(next.webSearchPrefs.recencyDays).toBe(30);
    expect(next.webSearchPrefs.allowedDomains).toEqual(["arxiv.org"]);
  });

  it("clamps out-of-range maxUses on migration", () => {
    const broken = {
      theme: "dark",
      webSearchPrefs: {
        enabled: false,
        maxUses: 999,
        searchMode: "default",
        recencyDays: -5,
        allowedDomains: ["arxiv.org", "  ", ""],
        blockedDomains: [],
      },
    };
    const next = migratePrefs(broken, 11) as unknown as MigratedShape;
    expect(next.webSearchPrefs.maxUses).toBe(10);
    expect(next.webSearchPrefs.recencyDays).toBe(0);
    expect(next.webSearchPrefs.allowedDomains).toEqual(["arxiv.org"]);
  });

  it("resets to defaults when webSearchPrefs is malformed", () => {
    const broken = { theme: "dark", webSearchPrefs: { foo: "bar" } };
    const next = migratePrefs(broken, 11) as unknown as MigratedShape;
    expect(next.webSearchPrefs).toEqual(DEFAULT_WEB_SEARCH_PREFS);
  });

  it("does not affect modelBindings v11 migration path", () => {
    // Regression guard: v12 branch shouldn't touch unrelated state.
    const v10State = {
      theme: "dark",
      modelBindings: {
        chat: "anthropic::claude-sonnet-4-6",
        summary: "anthropic::claude-sonnet-4-6",
        quick: "anthropic::claude-haiku-4-5",
        embedPresetId: "openai-3-small",
        flashcardGen: "anthropic::claude-sonnet-4-6",
      },
    };
    const next = migratePrefs(v10State, 10) as unknown as {
      modelBindings: { researchProvider: string };
      webSearchPrefs: WebSearchPrefs;
    };
    expect(next.modelBindings.researchProvider).toBe("readability");
    expect(next.webSearchPrefs).toEqual(DEFAULT_WEB_SEARCH_PREFS);
  });
});

describe("webSearchPrefsToOptions", () => {
  it("converts a fully-configured prefs object", () => {
    const opts = webSearchPrefsToOptions({
      enabled: true,
      maxUses: 4,
      searchMode: "deep",
      recencyDays: 14,
      allowedDomains: ["arxiv.org"],
      blockedDomains: ["spam.example"],
    });
    expect(opts).toEqual({
      maxUses: 4,
      searchMode: "deep",
      recencyDays: 14,
      allowedDomains: ["arxiv.org"],
      blockedDomains: ["spam.example"],
    });
  });

  it("drops recencyDays when 0 (no filter)", () => {
    const opts = webSearchPrefsToOptions({
      enabled: false,
      maxUses: 5,
      searchMode: "default",
      recencyDays: 0,
      allowedDomains: [],
      blockedDomains: [],
    });
    expect(opts.recencyDays).toBeUndefined();
  });

  it("drops empty domain lists so adapters don't emit empty arrays", () => {
    const opts = webSearchPrefsToOptions({
      enabled: false,
      maxUses: 5,
      searchMode: "default",
      recencyDays: 0,
      allowedDomains: [],
      blockedDomains: [],
    });
    expect(opts.allowedDomains).toBeUndefined();
    expect(opts.blockedDomains).toBeUndefined();
  });

  it("returns a defensive copy of domain arrays (caller mutation safe)", () => {
    const prefs: WebSearchPrefs = {
      enabled: false,
      maxUses: 5,
      searchMode: "default",
      recencyDays: 0,
      allowedDomains: ["arxiv.org"],
      blockedDomains: [],
    };
    const opts = webSearchPrefsToOptions(prefs);
    opts.allowedDomains?.push("mutated.example");
    expect(prefs.allowedDomains).toEqual(["arxiv.org"]);
  });
});
