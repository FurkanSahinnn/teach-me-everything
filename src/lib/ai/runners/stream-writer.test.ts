import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreamWriter } from "./stream-writer";

afterEach(() => vi.useRealTimers());
describe("stream persistence", () => {
  it("waits for a slow intermediate write before saving the final response", async () => {
    vi.useFakeTimers();
    let text = "first";
    let release!: () => void;
    const writes: string[] = [];
    const slow = new Promise<void>((resolve) => { release = resolve; });
    const writer = createStreamWriter(() => text, async (value) => {
      if (value === "first") await slow;
      writes.push(value);
    });
    writer.schedule();
    await vi.advanceTimersByTimeAsync(80);
    text = "first and final";
    writer.schedule();
    let finished = false;
    const final = writer.finish().then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await final;
    await vi.runAllTimersAsync();
    expect(writes).toEqual(["first", "first and final"]);
  });

  it("surfaces database failures without unhandled timer rejections", async () => {
    vi.useFakeTimers();
    const writer = createStreamWriter(() => "text", async () => { throw new Error("write failed"); });
    writer.schedule();
    await vi.advanceTimersByTimeAsync(80);
    await expect(writer.finish()).rejects.toThrow("write failed");
  });
});
