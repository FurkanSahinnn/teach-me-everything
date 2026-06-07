import { describe, expect, it } from "vitest";

import {
  DEFAULT_NOTES_UI_PREFS,
  migratePrefs,
  type NotesUiPrefs,
} from "./prefs";

type MigratedShape = {
  notesUi: NotesUiPrefs;
};

describe("prefs v15 migration — notesUi daily fields", () => {
  it("seeds empty dailyTemplate + dailyFolderName when migrating from v13", () => {
    const v13State = {
      theme: "dark",
      // Pre-v14: no notesUi field at all.
    };
    const next = migratePrefs(v13State, 13) as unknown as MigratedShape;
    expect(next.notesUi).toEqual(DEFAULT_NOTES_UI_PREFS);
    expect(next.notesUi.dailyTemplate).toBe("");
    expect(next.notesUi.dailyFolderName).toBe("");
  });

  it("preserves expandedFolders when v14 user upgrades to v15", () => {
    const v14State = {
      theme: "dark",
      notesUi: {
        expandedFolders: ["nfld_abc", "nfld_xyz"],
      },
    };
    const next = migratePrefs(v14State, 14) as unknown as MigratedShape;
    expect(next.notesUi.expandedFolders).toEqual(["nfld_abc", "nfld_xyz"]);
    expect(next.notesUi.dailyTemplate).toBe("");
    expect(next.notesUi.dailyFolderName).toBe("");
  });

  it("keeps already-set dailyTemplate + dailyFolderName when present", () => {
    const v15State = {
      theme: "dark",
      notesUi: {
        expandedFolders: ["nfld_abc"],
        dailyTemplate: "# Custom-{{date}}\n",
        dailyFolderName: "Journal",
      },
    };
    const next = migratePrefs(v15State, 15) as unknown as MigratedShape;
    expect(next.notesUi.expandedFolders).toEqual(["nfld_abc"]);
    expect(next.notesUi.dailyTemplate).toBe("# Custom-{{date}}\n");
    expect(next.notesUi.dailyFolderName).toBe("Journal");
  });

  it("resets to defaults if notesUi is missing entirely", () => {
    const broken = { theme: "dark" };
    const next = migratePrefs(broken, 13) as unknown as MigratedShape;
    expect(next.notesUi).toEqual(DEFAULT_NOTES_UI_PREFS);
  });

  it("patches partial v14 payloads (missing daily fields) without losing folders", () => {
    const partial = {
      theme: "dark",
      notesUi: {
        expandedFolders: ["nfld_one"],
        // dailyTemplate omitted
      },
    };
    const next = migratePrefs(partial, 14) as unknown as MigratedShape;
    expect(next.notesUi.expandedFolders).toEqual(["nfld_one"]);
    expect(next.notesUi.dailyTemplate).toBe("");
    expect(next.notesUi.dailyFolderName).toBe("");
  });

  it("ignores non-string daily fields", () => {
    const weird = {
      theme: "dark",
      notesUi: {
        expandedFolders: [],
        dailyTemplate: 42,
        dailyFolderName: ["not", "a", "string"],
      },
    };
    const next = migratePrefs(weird, 14) as unknown as MigratedShape;
    expect(next.notesUi.dailyTemplate).toBe("");
    expect(next.notesUi.dailyFolderName).toBe("");
  });
});
