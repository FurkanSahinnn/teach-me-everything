import { describe, expect, it } from "vitest";
import {
  applyConflictPolicy,
  CONFLICT_POLICIES,
  DEFAULT_CONFLICT_POLICY,
  isConflictPolicy,
  type ConflictPolicy,
} from "./conflict-policy";
import type { ReconcileAction } from "./reconcile";

const noop: ReconcileAction = { kind: "noop", reason: "test" };
const skip: ReconcileAction = { kind: "skip-hash-match", noteId: "n1" };
const importUpdate: ReconcileAction = {
  kind: "import-update",
  noteId: "n1",
  content: "disk content",
  mtimeMs: 1_500,
};
const importNew: ReconcileAction = {
  kind: "import-new",
  absPath: "/v/x.md",
  content: "x",
  folderId: null,
};
const del: ReconcileAction = { kind: "delete-note", noteId: "n1" };
const conflict: ReconcileAction = {
  kind: "conflict-dexie-wins",
  noteId: "n1",
  diskContent: "stale disk",
  diskMtimeMs: 500,
  noteUpdatedAt: 2_000,
};

describe("vault/conflict-policy constants", () => {
  it("lists all three policies in a stable order", () => {
    expect([...CONFLICT_POLICIES]).toEqual(["lww", "always-disk", "always-dexie"]);
  });

  it("defaults to lww", () => {
    expect(DEFAULT_CONFLICT_POLICY).toBe("lww");
  });

  it("isConflictPolicy gates string values", () => {
    expect(isConflictPolicy("lww")).toBe(true);
    expect(isConflictPolicy("always-disk")).toBe(true);
    expect(isConflictPolicy("always-dexie")).toBe(true);
    expect(isConflictPolicy("prompt")).toBe(false);
    expect(isConflictPolicy("")).toBe(false);
    expect(isConflictPolicy(null)).toBe(false);
    expect(isConflictPolicy(undefined)).toBe(false);
    expect(isConflictPolicy(42)).toBe(false);
  });
});

describe("vault/conflict-policy lww (pass-through)", () => {
  const cases: ReconcileAction[] = [noop, skip, importUpdate, importNew, del, conflict];
  for (const a of cases) {
    it(`passes through ${a.kind}`, () => {
      expect(applyConflictPolicy(a, "lww")).toEqual(a);
    });
  }
});

describe("vault/conflict-policy always-disk", () => {
  it("remaps conflict-dexie-wins → import-update with disk data", () => {
    const result = applyConflictPolicy(conflict, "always-disk");
    expect(result).toEqual({
      kind: "import-update",
      noteId: "n1",
      content: "stale disk",
      mtimeMs: 500,
    });
  });

  it("leaves import-update untouched (already disk-wins direction)", () => {
    expect(applyConflictPolicy(importUpdate, "always-disk")).toEqual(importUpdate);
  });

  it("leaves unrelated actions untouched", () => {
    expect(applyConflictPolicy(noop, "always-disk")).toEqual(noop);
    expect(applyConflictPolicy(skip, "always-disk")).toEqual(skip);
    expect(applyConflictPolicy(importNew, "always-disk")).toEqual(importNew);
    expect(applyConflictPolicy(del, "always-disk")).toEqual(del);
  });
});

describe("vault/conflict-policy always-dexie", () => {
  it("remaps import-update → conflict-dexie-wins so disk gets overwritten", () => {
    const result = applyConflictPolicy(importUpdate, "always-dexie");
    expect(result).toEqual({
      kind: "conflict-dexie-wins",
      noteId: "n1",
      diskContent: "disk content",
      diskMtimeMs: 1_500,
      noteUpdatedAt: 0,
    });
  });

  it("leaves conflict-dexie-wins untouched (already dexie-wins direction)", () => {
    expect(applyConflictPolicy(conflict, "always-dexie")).toEqual(conflict);
  });

  it("leaves unrelated actions untouched", () => {
    expect(applyConflictPolicy(noop, "always-dexie")).toEqual(noop);
    expect(applyConflictPolicy(skip, "always-dexie")).toEqual(skip);
    expect(applyConflictPolicy(importNew, "always-dexie")).toEqual(importNew);
    expect(applyConflictPolicy(del, "always-dexie")).toEqual(del);
  });
});

describe("vault/conflict-policy round-trip identity", () => {
  it("re-applying the same policy is idempotent", () => {
    const policies: ConflictPolicy[] = ["lww", "always-disk", "always-dexie"];
    const cases: ReconcileAction[] = [noop, skip, importUpdate, importNew, del, conflict];
    for (const p of policies) {
      for (const a of cases) {
        const once = applyConflictPolicy(a, p);
        const twice = applyConflictPolicy(once, p);
        expect(twice).toEqual(once);
      }
    }
  });
});
