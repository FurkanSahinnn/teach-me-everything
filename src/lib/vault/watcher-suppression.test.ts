import { afterEach, describe, expect, it } from "vitest";
import {
  _clearRecentWritesForTests,
  _setNowForTests,
  DEFAULT_SUPPRESS_TTL_MS,
  markRecentWrite,
  wasRecentlyWritten,
} from "./watcher-suppression";

afterEach(() => {
  _clearRecentWritesForTests();
  _setNowForTests(null);
});

describe("vault/watcher-suppression", () => {
  it("returns false for never-marked path", () => {
    expect(wasRecentlyWritten("/a.md")).toBe(false);
  });

  it("returns true within the TTL window", () => {
    _setNowForTests(() => 1000);
    markRecentWrite("/a.md", 2000);
    _setNowForTests(() => 1500);
    expect(wasRecentlyWritten("/a.md")).toBe(true);
  });

  it("returns false and GCs after the TTL expires", () => {
    _setNowForTests(() => 1000);
    markRecentWrite("/a.md", 1000);
    _setNowForTests(() => 2500);
    expect(wasRecentlyWritten("/a.md")).toBe(false);
    // re-query after GC still returns false without a new mark
    expect(wasRecentlyWritten("/a.md")).toBe(false);
  });

  it("uses default TTL when none provided", () => {
    _setNowForTests(() => 0);
    markRecentWrite("/a.md");
    _setNowForTests(() => DEFAULT_SUPPRESS_TTL_MS - 1);
    expect(wasRecentlyWritten("/a.md")).toBe(true);
    _setNowForTests(() => DEFAULT_SUPPRESS_TTL_MS + 1);
    expect(wasRecentlyWritten("/a.md")).toBe(false);
  });

  it("re-marking extends the expiry", () => {
    _setNowForTests(() => 0);
    markRecentWrite("/a.md", 500);
    _setNowForTests(() => 400);
    markRecentWrite("/a.md", 2000);
    _setNowForTests(() => 1500);
    expect(wasRecentlyWritten("/a.md")).toBe(true);
  });

  it("treats different paths independently", () => {
    _setNowForTests(() => 1000);
    markRecentWrite("/a.md", 2000);
    expect(wasRecentlyWritten("/b.md")).toBe(false);
    expect(wasRecentlyWritten("/a.md")).toBe(true);
  });

  it("negative TTL clamps to 0 (expires immediately)", () => {
    _setNowForTests(() => 1000);
    markRecentWrite("/a.md", -500);
    _setNowForTests(() => 1001);
    expect(wasRecentlyWritten("/a.md")).toBe(false);
  });
});
