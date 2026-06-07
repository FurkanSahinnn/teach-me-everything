import { describe, it, expect } from "vitest";
import { migratePrefs, DEFAULT_VAULT_PREFS } from "./prefs";
import { DEFAULT_CONFLICT_POLICY } from "@/lib/vault/conflict-policy";

describe("migratePrefs v16 → v17 → v18 (vault slice)", () => {
  it("seeds defaults (including conflictPolicy) when vault slice is missing", () => {
    const migrated = migratePrefs(
      {
        theme: "dark",
        themeFollowsSystem: false,
        density: "normal",
        locale: "tr",
      },
      16,
    );
    expect((migrated as { vault: unknown }).vault).toEqual(DEFAULT_VAULT_PREFS);
  });

  it("patches conflictPolicy onto an existing pre-v18 vault slice", () => {
    const cur = {
      rootPath: "/home/alice/Notes",
      setupCompleted: true,
      autoSync: false,
    };
    const migrated = migratePrefs(
      { theme: "dark", themeFollowsSystem: false, vault: cur },
      16,
    );
    expect((migrated as { vault: typeof cur & { conflictPolicy: string } }).vault).toEqual({
      ...cur,
      conflictPolicy: DEFAULT_CONFLICT_POLICY,
    });
  });

  it("coerces empty-string rootPath to null while populating conflictPolicy", () => {
    const migrated = migratePrefs(
      {
        theme: "dark",
        themeFollowsSystem: false,
        vault: { rootPath: "", setupCompleted: true, autoSync: true },
      },
      16,
    );
    const v = (migrated as { vault: { rootPath: string | null; conflictPolicy: string } })
      .vault;
    expect(v.rootPath).toBeNull();
    expect(v.conflictPolicy).toBe(DEFAULT_CONFLICT_POLICY);
  });

  it("resets the slice when shape is invalid (non-object)", () => {
    const migrated = migratePrefs(
      {
        theme: "dark",
        themeFollowsSystem: false,
        vault: ["not", "an", "object"],
      },
      16,
    );
    expect((migrated as { vault: unknown }).vault).toEqual(DEFAULT_VAULT_PREFS);
  });

  it("is idempotent on a fresh v18 payload", () => {
    const fresh = {
      theme: "dark",
      themeFollowsSystem: false,
      vault: { ...DEFAULT_VAULT_PREFS },
    };
    const migrated = migratePrefs(fresh, 18);
    expect((migrated as { vault: unknown }).vault).toEqual(DEFAULT_VAULT_PREFS);
  });

  it("v17 payload with valid existing conflictPolicy is preserved through v18 step", () => {
    const cur = {
      rootPath: "/p",
      setupCompleted: true,
      autoSync: true,
      conflictPolicy: "always-disk",
    };
    const migrated = migratePrefs(
      { theme: "dark", themeFollowsSystem: false, vault: cur },
      17,
    );
    expect((migrated as { vault: typeof cur }).vault).toEqual(cur);
  });

  it("v18 patches conflictPolicy when v17 payload is missing it", () => {
    const cur = {
      rootPath: "/p",
      setupCompleted: true,
      autoSync: false,
    };
    const migrated = migratePrefs(
      { theme: "dark", themeFollowsSystem: false, vault: cur },
      17,
    );
    expect(
      (migrated as { vault: { conflictPolicy: string } }).vault.conflictPolicy,
    ).toBe(DEFAULT_CONFLICT_POLICY);
  });

  it("v18 resets an invalid conflictPolicy string to the default", () => {
    const cur = {
      rootPath: "/p",
      setupCompleted: true,
      autoSync: true,
      conflictPolicy: "manual",
    };
    const migrated = migratePrefs(
      { theme: "dark", themeFollowsSystem: false, vault: cur },
      17,
    );
    expect(
      (migrated as { vault: { conflictPolicy: string } }).vault.conflictPolicy,
    ).toBe(DEFAULT_CONFLICT_POLICY);
  });
});
