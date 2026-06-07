import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countWords, createDebouncedSaver } from "./cm6-extensions";

describe("countWords", () => {
  it("returns 0 on empty / whitespace-only input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n   ")).toBe(0);
  });

  it("counts plain words split on any whitespace", () => {
    expect(countWords("hello world")).toBe(2);
    expect(countWords("a  b\tc\nd")).toBe(4);
  });

  it("ignores ATX heading markers", () => {
    expect(countWords("# Heading one\n## Heading two")).toBe(4);
  });

  it("ignores list and blockquote markers", () => {
    expect(countWords("- one\n- two\n- three")).toBe(3);
    expect(countWords("1. a\n2. b")).toBe(2);
    expect(countWords("> quoted line")).toBe(2);
  });

  it("ignores task-list markers", () => {
    expect(countWords("- [ ] do this\n- [x] done")).toBe(3);
  });

  it("strips emphasis markers", () => {
    expect(countWords("**bold** _italic_ ~~strike~~")).toBe(3);
  });

  it("excludes content inside fenced code blocks", () => {
    expect(countWords("hello\n```\nignored code body\n```\nworld")).toBe(2);
  });

  it("excludes inline code", () => {
    expect(countWords("call `someFunction()` carefully")).toBe(2);
  });

  it("counts wikilink alias when present, else target", () => {
    expect(countWords("see [[Note]] and [[Other|alias text]]")).toBe(5);
  });

  it("counts link label but not URL", () => {
    expect(countWords("[label here](https://example.com/path)")).toBe(2);
  });
});

describe("createDebouncedSaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes saveFn once after the delay window", async () => {
    const saved = vi.fn();
    const s = createDebouncedSaver<string>(saved, 100);
    s.schedule("a");
    expect(saved).not.toHaveBeenCalled();
    expect(s.pending()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(saved).toHaveBeenCalledOnce();
    expect(saved).toHaveBeenCalledWith("a");
    expect(s.pending()).toBe(false);
  });

  it("uses only the most recent value when scheduled repeatedly", () => {
    const saved = vi.fn();
    const s = createDebouncedSaver<string>(saved, 100);
    s.schedule("first");
    vi.advanceTimersByTime(50);
    s.schedule("second");
    vi.advanceTimersByTime(50);
    expect(saved).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(saved).toHaveBeenCalledOnce();
    expect(saved).toHaveBeenCalledWith("second");
  });

  it("flush() invokes saveFn synchronously when pending", async () => {
    const saved = vi.fn();
    const s = createDebouncedSaver<string>(saved, 100);
    s.schedule("v");
    await s.flush();
    expect(saved).toHaveBeenCalledOnce();
    expect(saved).toHaveBeenCalledWith("v");
    // After flushing, the timer should not fire again.
    vi.advanceTimersByTime(200);
    expect(saved).toHaveBeenCalledOnce();
  });

  it("flush() is a no-op when no save is pending", async () => {
    const saved = vi.fn();
    const s = createDebouncedSaver<string>(saved, 100);
    await s.flush();
    expect(saved).not.toHaveBeenCalled();
  });

  it("cancel() drops the pending save", () => {
    const saved = vi.fn();
    const s = createDebouncedSaver<string>(saved, 100);
    s.schedule("v");
    expect(s.pending()).toBe(true);
    s.cancel();
    expect(s.pending()).toBe(false);
    vi.advanceTimersByTime(200);
    expect(saved).not.toHaveBeenCalled();
  });
});
