import { describe, expect, it } from "vitest";
import type { ChunkRecord } from "@/lib/db/types";
import { findChunkForRef } from "./CitationChip";

// findChunkForRef only reads `section` / `headings`, so a minimal cast keeps the
// fixtures readable without reconstructing the full ChunkRecord shape.
function mk(
  id: string,
  partial: { section?: string; headings?: string[] },
): ChunkRecord {
  return {
    id,
    sourceId: "s1",
    ...(partial.section !== undefined ? { section: partial.section } : {}),
    ...(partial.headings !== undefined ? { headings: partial.headings } : {}),
  } as unknown as ChunkRecord;
}

describe("findChunkForRef", () => {
  const chunks = [
    mk("a", { section: "2.3 Superposition" }),
    mk("b", { section: "1.1 Intro" }),
  ];

  it("resolves a bare reader-style [§section] ref", () => {
    expect(findChunkForRef("2.3 Superposition", chunks)?.id).toBe("a");
  });

  it("resolves a workspace-style [§<title> · <section>] ref via the trailing section", () => {
    expect(
      findChunkForRef("Quantum Mechanics · 2.3 Superposition", chunks)?.id,
    ).toBe("a");
  });

  it("returns null when neither the full ref nor the trailing section matches", () => {
    expect(findChunkForRef("Some Book · 9.9 Nonexistent", chunks)).toBeNull();
  });

  it("prefers a direct full-ref match over the ` · ` section-split fallback", () => {
    const tricky = [
      mk("x", { section: "Alpha · Beta" }),
      mk("y", { section: "Beta" }),
    ];
    // The full ref equals chunk x's section exactly → the direct match wins
    // over splitting on ` · ` (which would have matched y on "Beta").
    expect(findChunkForRef("Alpha · Beta", tricky)?.id).toBe("x");
  });
});
