import { describe, expect, it, vi } from "vitest";

import {
  isRetryableStreamError,
  mapWithConcurrency,
  ProviderStreamError,
  runWithRetry,
  StageError,
} from "./stage-runner";

const tick = (ms = 0): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("isRetryableStreamError", () => {
  it.each([429, 0, 500, 503, 529])("treats status %i as transient", (status) => {
    expect(isRetryableStreamError(new ProviderStreamError(status, "x"))).toBe(
      true,
    );
  });

  it.each([400, 401, 403, 404, 422])(
    "treats status %i as a real request defect",
    (status) => {
      expect(isRetryableStreamError(new ProviderStreamError(status, "x"))).toBe(
        false,
      );
    },
  );

  it("does not retry a parse failure", () => {
    expect(isRetryableStreamError(new StageError("schema_failed"))).toBe(false);
  });

  it("does not retry a non-Error value", () => {
    expect(isRetryableStreamError("boom")).toBe(false);
  });

  it("keeps the status readable both as a field and in the message", () => {
    const err = new ProviderStreamError(429, "rate limited");
    expect(err.status).toBe(429);
    expect(err.message).toBe("Provider error 429: rate limited");
  });
});

describe("runWithRetry", () => {
  const retryOnce = {
    isRetryable: isRetryableStreamError,
    delaysMs: [0],
  } as const;

  it("returns the first result when nothing fails", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(runWithRetry(fn, retryOnce)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a shed request and returns the second result", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderStreamError(429, "rate limited"))
      .mockResolvedValueOnce("ok");
    await expect(runWithRetry(fn, retryOnce)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable failure", async () => {
    const fn = vi.fn().mockRejectedValue(new StageError("schema_failed"));
    await expect(runWithRetry(fn, retryOnce)).rejects.toBeInstanceOf(StageError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured attempts and throws the last error", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new ProviderStreamError(529, "overloaded"));
    await expect(runWithRetry(fn, retryOnce)).rejects.toThrow(
      "Provider error 529",
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cuts the backoff short on abort so the caller's own guard decides", async () => {
    const controller = new AbortController();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderStreamError(429, "rate limited"))
      .mockRejectedValueOnce(new Error("caller abort guard"));
    const running = runWithRetry(fn, {
      isRetryable: isRetryableStreamError,
      // Long enough that the test would time out if abort did not short it.
      delaysMs: [30_000],
      signal: controller.signal,
    });
    await tick();
    controller.abort();
    await expect(running).rejects.toThrow("caller abort guard");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("mapWithConcurrency", () => {
  it("returns an empty array without invoking the task", async () => {
    const task = vi.fn();
    await expect(mapWithConcurrency([], 3, task)).resolves.toEqual([]);
    expect(task).not.toHaveBeenCalled();
  });

  it("keeps at most `limit` tasks in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 9 }, (_, i) => i),
      3,
      async (n) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight -= 1;
        return n;
      },
    );
    expect(peak).toBe(3);
  });

  it("runs every item even when the pool is narrower than the input", async () => {
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      await tick();
      seen.push(n);
      return n;
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns results in input order regardless of completion order", async () => {
    const settled = await mapWithConcurrency(
      [30, 0, 20, 0, 10],
      5,
      async (ms, index) => {
        await tick(ms);
        return index;
      },
    );
    expect(
      settled.map((r) => (r.status === "fulfilled" ? r.value : -1)),
    ).toEqual([0, 1, 2, 3, 4]);
  });

  it("isolates a failing task and still settles the rest", async () => {
    const settled = await mapWithConcurrency([0, 1, 2, 3], 2, async (n) => {
      if (n === 1) throw new Error("boom");
      return n * 10;
    });
    expect(settled[1]).toMatchObject({ status: "rejected" });
    expect(
      settled.filter((r) => r.status === "fulfilled").map((r) => r.value),
    ).toEqual([0, 20, 30]);
  });

  it("never rejects, even when every task throws", async () => {
    const settled = await mapWithConcurrency([1, 2], 2, async () => {
      throw new Error("all bad");
    });
    expect(settled.every((r) => r.status === "rejected")).toBe(true);
  });
});
