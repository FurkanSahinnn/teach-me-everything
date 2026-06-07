import { afterEach, describe, expect, it } from "vitest";
import { _clearLocksForTests, isLocked, withFileLock } from "./lock";

afterEach(() => {
  _clearLocksForTests();
});

describe("vault/lock", () => {
  it("runs fn immediately when no lock is held", async () => {
    const result = await withFileLock("/a", async () => "done");
    expect(result).toBe("done");
    expect(isLocked("/a")).toBe(false);
  });

  it("isLocked is true while the op runs, false after", async () => {
    let resolveBlock!: () => void;
    const block = new Promise<void>((r) => {
      resolveBlock = r;
    });
    const op = withFileLock("/a", async () => {
      await block;
      return "x";
    });
    expect(isLocked("/a")).toBe(true);
    resolveBlock();
    await op;
    expect(isLocked("/a")).toBe(false);
  });

  it("serialises same-path operations in FIFO order", async () => {
    const log: string[] = [];
    const slow = withFileLock("/a", async () => {
      log.push("slow-start");
      await new Promise((r) => setTimeout(r, 10));
      log.push("slow-end");
      return "slow";
    });
    const fast = withFileLock("/a", async () => {
      log.push("fast-start");
      log.push("fast-end");
      return "fast";
    });
    await Promise.all([slow, fast]);
    expect(log).toEqual([
      "slow-start",
      "slow-end",
      "fast-start",
      "fast-end",
    ]);
  });

  it("does not serialise different paths", async () => {
    const log: string[] = [];
    const a = withFileLock("/a", async () => {
      log.push("a-start");
      await new Promise((r) => setTimeout(r, 10));
      log.push("a-end");
    });
    const b = withFileLock("/b", async () => {
      log.push("b-start");
      log.push("b-end");
    });
    await Promise.all([a, b]);
    // b's body should complete before a's slow body does
    expect(log.indexOf("b-end")).toBeLessThan(log.indexOf("a-end"));
  });

  it("errors in one op do not poison the queue", async () => {
    const failing = withFileLock("/a", async () => {
      throw new Error("boom");
    }).catch((e: Error) => e.message);
    const ok = withFileLock("/a", async () => "recovered");
    expect(await failing).toBe("boom");
    expect(await ok).toBe("recovered");
    expect(isLocked("/a")).toBe(false);
  });

  it("third op queues behind two prior ops on same path", async () => {
    const order: number[] = [];
    const ops = [1, 2, 3].map((n) =>
      withFileLock("/a", async () => {
        order.push(n);
        await new Promise((r) => setTimeout(r, 1));
      }),
    );
    await Promise.all(ops);
    expect(order).toEqual([1, 2, 3]);
  });
});
