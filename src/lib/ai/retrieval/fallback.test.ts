import { describe, expect, it } from "vitest";
import { selectFallbackChunks } from "./fallback";

describe("local chat retrieval fallback", () => {
  it("finds the requested passage beyond the opening chunks without embeddings", () => {
    const chunks = [
      ...Array.from({ length: 20 }, (_, index) => ({ text: `Introduction and general background ${index}` })),
      { text: "Entanglement correlates measurement outcomes across distant particles." },
    ];
    expect(selectFallbackChunks(chunks, "Explain entanglement and measurement outcomes", 2)[0]).toBe(chunks[20]);
  });
  it("matches Turkish text and section headings, and preserves input records", () => {
    const chunks = [{ text: "Genel giriş" }, { section: "IŞIK KIRILMASI", text: "Ortamların optik yoğunluğu değişir." }];
    const before = structuredClone(chunks);
    expect(selectFallbackChunks(chunks, "Işık kırılması neden olur?", 1)).toEqual([chunks[1]]);
    expect(chunks).toEqual(before);
  });
  it("preserves stable source order when there is no lexical match", () => {
    const chunks = [{ text: "Alpha" }, { text: "Beta" }, { text: "Gamma" }];
    expect(selectFallbackChunks(chunks, "Unrelated question", 2)).toEqual(chunks.slice(0, 2));
    expect(selectFallbackChunks(chunks, "", 2)).toEqual(chunks.slice(0, 2));
    expect(selectFallbackChunks(chunks, "Alpha", 0)).toEqual([]);
    expect(selectFallbackChunks([], "Alpha", 4)).toEqual([]);
  });
  it("cannot select outside the caller's source scope", () => {
    const allowed = [{ text: "First selected source" }, { text: "Second selected source" }];
    expect(selectFallbackChunks(allowed, "secret excluded source", 16)).toHaveLength(2);
    expect(selectFallbackChunks(allowed, "secret excluded source", 16).every((chunk) => allowed.includes(chunk))).toBe(true);
  });
});
