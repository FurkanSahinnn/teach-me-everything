import { describe, expect, it } from "vitest";
import { chooseRechunkStrategy } from "./rechunk";

describe("chooseRechunkStrategy", () => {
  it("rebuilds uploads from their stored blob", () => {
    expect(chooseRechunkStrategy({ type: "pdf" }, true)).toEqual({ strategy: "blob" });
    expect(chooseRechunkStrategy({ type: "md" }, true)).toEqual({ strategy: "blob" });
  });

  it("asks for a re-upload when the blob was never stored", () => {
    // txt/md uploads before 2026-09 did not persist the file.
    expect(chooseRechunkStrategy({ type: "md" }, false)).toEqual({
      strategy: "unsupported",
      reason: "no_blob",
    });
  });

  it("re-fetches research sources by URL", () => {
    expect(chooseRechunkStrategy({ type: "url", url: "https://x.test" }, false)).toEqual({
      strategy: "refetch",
    });
    expect(chooseRechunkStrategy({ type: "arxiv" }, false)).toEqual({
      strategy: "unsupported",
      reason: "no_url",
    });
  });

  it("re-reads note sources from the live note", () => {
    expect(chooseRechunkStrategy({ type: "note", noteId: "n1" }, false)).toEqual({
      strategy: "note",
    });
  });

  it("leaves formats it cannot re-parse alone", () => {
    expect(chooseRechunkStrategy({ type: "epub" }, true)).toEqual({
      strategy: "unsupported",
      reason: "type",
    });
  });
});
