import { describe, expect, it } from "vitest";
import { scanTags } from "./tag-widget";

describe("scanTags", () => {
  it("returns an empty array when no tags are present", () => {
    expect(scanTags("plain text without any tags")).toEqual([]);
  });

  it("finds a single tag at the start of text", () => {
    const matches = scanTags("#kimya rest of the line");
    expect(matches).toHaveLength(1);
    const m = matches[0]!;
    expect(m.raw).toBe("#kimya");
    expect(m.tag).toBe("kimya");
    expect(m.from).toBe(0);
    expect(m.to).toBe(6);
  });

  it("requires whitespace or start before # — mid-word hashes are rejected", () => {
    expect(scanTags("not#a#tag")).toEqual([]);
    expect(scanTags("url.com/path#fragment")).toEqual([]);
  });

  it("requires at least one letter — digit-only tags are skipped", () => {
    expect(scanTags("step #1 then #2")).toEqual([]);
    const matches = scanTags("see #v1 and #2024-01");
    expect(matches.map((m) => m.tag)).toEqual(["v1"]);
  });

  it("supports nested tags separated by /", () => {
    const matches = scanTags("topic #kimya/organik/halkalı here");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.tag).toBe("kimya/organik/halkalı");
  });

  it("supports Unicode letters (Turkish, German, Greek)", () => {
    const matches = scanTags("#öğretim #straße #δοκιμή");
    expect(matches.map((m) => m.tag)).toEqual(["öğretim", "straße", "δοκιμή"]);
  });

  it("lowercases tag values while preserving raw casing", () => {
    const matches = scanTags("read #KIMYA today");
    expect(matches[0]?.raw).toBe("#KIMYA");
    expect(matches[0]?.tag).toBe("kimya");
  });

  it("deduplicates is the caller's job — scanTags returns every occurrence", () => {
    const matches = scanTags("#foo and again #foo");
    expect(matches).toHaveLength(2);
    expect(matches[0]?.tag).toBe("foo");
    expect(matches[1]?.tag).toBe("foo");
  });

  it("correctly reports byte positions for the leading hash", () => {
    const text = "lead in #kimya next";
    const matches = scanTags(text);
    expect(text.slice(matches[0]!.from, matches[0]!.to)).toBe("#kimya");
  });

  it("does not include the boundary character in the match span", () => {
    const text = "a #foo b";
    const matches = scanTags(text);
    expect(matches[0]?.from).toBe(2);
    expect(matches[0]?.to).toBe(6);
    expect(text.slice(2, 6)).toBe("#foo");
  });

  it("allows hyphen and underscore in the tag body", () => {
    const matches = scanTags("see #project-2026 and #snake_case");
    expect(matches.map((m) => m.tag)).toEqual(["project-2026", "snake_case"]);
  });

  it("stops the tag body at punctuation or whitespace", () => {
    const matches = scanTags("#alpha, then #beta. final #gamma");
    expect(matches.map((m) => m.tag)).toEqual(["alpha", "beta", "gamma"]);
  });
});
