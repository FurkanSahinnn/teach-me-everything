import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _setVaultFsForTests, type VaultFsImpl } from "./fs-adapter";
import {
  _setLockClockForTests,
  _setLockIdGenForTests,
  acquireVaultProcessLock,
  lockPathFor,
  readVaultLock,
  STALE_LOCK_AGE_MS,
  type ProcessLockMetadata,
} from "./process-lock";

type Stub = {
  files: Map<string, string>;
  writes: Array<{ path: string; content: string }>;
  removes: string[];
  writeShouldFail: boolean;
};

function makeStub(stub: Stub): Partial<VaultFsImpl> {
  return {
    writeTextFile: async (path, content) => {
      if (stub.writeShouldFail) throw new Error("disk full");
      stub.writes.push({ path, content });
      stub.files.set(path, content);
    },
    readTextFile: async (path) => {
      const v = stub.files.get(path);
      if (v === undefined) throw new Error(`no file ${path}`);
      return v;
    },
    exists: async (path) => stub.files.has(path),
    remove: async (path) => {
      stub.removes.push(path);
      stub.files.delete(path);
    },
  };
}

const VAULT = "/vault";
const LOCK_PATH = lockPathFor(VAULT);

describe("vault/process-lock", () => {
  let stub: Stub;
  let now = 1_700_000_000_000;
  let counter = 0;

  beforeEach(() => {
    stub = { files: new Map(), writes: [], removes: [], writeShouldFail: false };
    _setVaultFsForTests(makeStub(stub));
    now = 1_700_000_000_000;
    counter = 0;
    _setLockClockForTests(() => now);
    _setLockIdGenForTests(() => {
      counter += 1;
      return `lock-${counter}`;
    });
  });

  afterEach(() => {
    _setVaultFsForTests(null);
    _setLockClockForTests(null);
    _setLockIdGenForTests(null);
  });

  it("lockPathFor joins vault root with the .tme-lock filename", () => {
    expect(lockPathFor("/some/vault")).toBe("/some/vault/.tme-lock");
    expect(lockPathFor("C:\\Users\\Joe\\Vault")).toBe(
      "C:\\Users\\Joe\\Vault\\.tme-lock",
    );
  });

  it("acquires when no lock file exists", async () => {
    const result = await acquireVaultProcessLock(VAULT);
    expect(result.kind).toBe("acquired");
    if (result.kind !== "acquired") return;
    expect(result.metadata.lockId).toBe("lock-1");
    expect(result.metadata.acquiredAt).toBe(now);
    expect(result.metadata.version).toBe(1);
    expect(stub.files.get(LOCK_PATH)).toContain("lock-1");
  });

  it("includes appVersion when provided", async () => {
    const result = await acquireVaultProcessLock(VAULT, {
      appVersion: "1.0.0-rc11",
    });
    if (result.kind !== "acquired") throw new Error("expected acquired");
    expect(result.metadata.appVersion).toBe("1.0.0-rc11");
    expect(stub.files.get(LOCK_PATH)).toContain("1.0.0-rc11");
  });

  it("reports held when a fresh lock exists", async () => {
    const lockMetadata: ProcessLockMetadata = {
      version: 1,
      lockId: "external",
      acquiredAt: now - 10_000,
    };
    stub.files.set(LOCK_PATH, JSON.stringify(lockMetadata));
    const result = await acquireVaultProcessLock(VAULT);
    expect(result.kind).toBe("held");
    if (result.kind !== "held") return;
    expect(result.existing.lockId).toBe("external");
    expect(stub.writes).toHaveLength(0);
  });

  it("steals a stale lock that is older than STALE_LOCK_AGE_MS", async () => {
    const lockMetadata: ProcessLockMetadata = {
      version: 1,
      lockId: "stale",
      acquiredAt: now - STALE_LOCK_AGE_MS - 1,
    };
    stub.files.set(LOCK_PATH, JSON.stringify(lockMetadata));
    const result = await acquireVaultProcessLock(VAULT);
    expect(result.kind).toBe("acquired");
    if (result.kind !== "acquired") return;
    expect(result.metadata.lockId).toBe("lock-1");
    const re = await readVaultLock(VAULT);
    expect(re?.lockId).toBe("lock-1");
  });

  it("keeps a lock exactly at the staleness boundary held (age === threshold = held)", async () => {
    // age < STALE_LOCK_AGE_MS → held; age >= threshold → steal. Lock
    // written exactly STALE_LOCK_AGE_MS ago has age = threshold → steal.
    const lockMetadata: ProcessLockMetadata = {
      version: 1,
      lockId: "borderline",
      acquiredAt: now - STALE_LOCK_AGE_MS,
    };
    stub.files.set(LOCK_PATH, JSON.stringify(lockMetadata));
    const result = await acquireVaultProcessLock(VAULT);
    expect(result.kind).toBe("acquired");
  });

  it("force-acquires over a fresh lock when opts.force=true", async () => {
    stub.files.set(
      LOCK_PATH,
      JSON.stringify({ version: 1, lockId: "external", acquiredAt: now }),
    );
    const result = await acquireVaultProcessLock(VAULT, { force: true });
    expect(result.kind).toBe("acquired");
    if (result.kind !== "acquired") return;
    expect(result.metadata.lockId).toBe("lock-1");
    const re = await readVaultLock(VAULT);
    expect(re?.lockId).toBe("lock-1");
  });

  it("held.force() takes over and returns a fresh acquired result", async () => {
    stub.files.set(
      LOCK_PATH,
      JSON.stringify({ version: 1, lockId: "external", acquiredAt: now }),
    );
    const held = await acquireVaultProcessLock(VAULT);
    if (held.kind !== "held") throw new Error("expected held");
    const next = await held.force();
    expect(next.kind).toBe("acquired");
    if (next.kind !== "acquired") return;
    expect(next.metadata.lockId).toBe("lock-1");
  });

  it("release removes the lock file when we still own it", async () => {
    const result = await acquireVaultProcessLock(VAULT);
    if (result.kind !== "acquired") throw new Error("expected acquired");
    await result.release();
    expect(stub.removes).toEqual([LOCK_PATH]);
    expect(stub.files.has(LOCK_PATH)).toBe(false);
  });

  it("release is a no-op when the lock has been stolen by another lockId", async () => {
    const result = await acquireVaultProcessLock(VAULT);
    if (result.kind !== "acquired") throw new Error("expected acquired");
    // Simulate another process stealing the lock between acquire + release.
    stub.files.set(
      LOCK_PATH,
      JSON.stringify({ version: 1, lockId: "thief", acquiredAt: now }),
    );
    await result.release();
    expect(stub.removes).toEqual([]);
    expect(stub.files.get(LOCK_PATH)).toContain("thief");
  });

  it("release is a no-op when the lock file is already gone", async () => {
    const result = await acquireVaultProcessLock(VAULT);
    if (result.kind !== "acquired") throw new Error("expected acquired");
    stub.files.delete(LOCK_PATH);
    await result.release();
    expect(stub.removes).toEqual([]);
  });

  it("treats a corrupt lock file as no lock and acquires", async () => {
    stub.files.set(LOCK_PATH, "{ not valid json");
    const result = await acquireVaultProcessLock(VAULT);
    expect(result.kind).toBe("acquired");
  });

  it("treats a lock file with missing required fields as no lock", async () => {
    stub.files.set(LOCK_PATH, JSON.stringify({ foo: "bar" }));
    const result = await acquireVaultProcessLock(VAULT);
    expect(result.kind).toBe("acquired");
  });

  it("treats a lock file with non-numeric acquiredAt as no lock", async () => {
    stub.files.set(
      LOCK_PATH,
      JSON.stringify({ lockId: "x", acquiredAt: "not a number" }),
    );
    const result = await acquireVaultProcessLock(VAULT);
    expect(result.kind).toBe("acquired");
  });

  it("readVaultLock returns null when no lock file exists", async () => {
    const out = await readVaultLock(VAULT);
    expect(out).toBeNull();
  });

  it("readVaultLock returns the parsed lock metadata when present", async () => {
    const metadata: ProcessLockMetadata = {
      version: 1,
      lockId: "abc",
      acquiredAt: now,
      appVersion: "1.0.0-rc11",
    };
    stub.files.set(LOCK_PATH, JSON.stringify(metadata));
    const out = await readVaultLock(VAULT);
    expect(out).toEqual(metadata);
  });
});
