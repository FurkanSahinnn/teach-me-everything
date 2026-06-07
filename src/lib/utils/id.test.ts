import { describe, expect, it } from "vitest";
import { isValidId, newId } from "./id";

describe("newId", () => {
  it("produces unique ids across many invocations", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i += 1) ids.add(newId());
    expect(ids.size).toBe(5000);
  });

  it("preserves the prefix when provided", () => {
    expect(newId("ws").startsWith("ws_")).toBe(true);
    expect(newId("flashcard").startsWith("flashcard_")).toBe(true);
  });

  it("is monotonic over time when generated across millisecond boundaries", async () => {
    const first = newId("x");
    await new Promise((r) => setTimeout(r, 5));
    const second = newId("x");
    await new Promise((r) => setTimeout(r, 5));
    const third = newId("x");
    // Strip the prefix so the timestamp segment compares correctly.
    const strip = (s: string) => s.replace(/^x_/, "");
    expect(strip(second) > strip(first)).toBe(true);
    expect(strip(third) > strip(second)).toBe(true);
  });
});

describe("isValidId", () => {
  it("accepts non-empty strings", () => {
    expect(isValidId("abc")).toBe(true);
  });

  it("rejects non-strings and empty strings", () => {
    expect(isValidId("")).toBe(false);
    expect(isValidId(123)).toBe(false);
    expect(isValidId(null)).toBe(false);
    expect(isValidId(undefined)).toBe(false);
  });
});
