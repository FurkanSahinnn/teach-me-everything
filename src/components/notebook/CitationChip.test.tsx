import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChunkRecord } from "@/lib/db/types";
import { CitationChip, findChunkForRef } from "./CitationChip";

afterEach(() => {
  cleanup();
});

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

describe("CitationChip (Phase 6.9.7 — note tone)", () => {
  it("renders the default § marker when tone is unset", () => {
    render(
      <CitationChip citationRef="2.3" active={true} onActivate={() => {}} />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("data-citation-ref", "2.3");
    expect(btn).toHaveAttribute("data-citation-tone", "default");
    // Default tone uses the § sigil prefix; "note" tone replaces it with an
    // SVG icon, so the visible glyph is the assertion that disambiguates.
    expect(btn.textContent).toContain("§");
  });

  it("renders the NotebookPen icon and emerald tone marker when tone='note'", () => {
    render(
      <CitationChip
        citationRef="learning-log"
        active={true}
        onActivate={() => {}}
        tone="note"
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("data-citation-tone", "note");
    // The § glyph must NOT render under the note variant.
    expect(btn.textContent).not.toContain("§");
    // Title prefix changes from `§{ref}` → `note · {ref}` so screen-reader
    // hover surfaces the citation kind without the user having to click.
    expect(btn).toHaveAttribute("title", "note · learning-log");
    // Lucide renders an inline SVG; an aria-hidden svg child is the chip's
    // only icon path under the note tone.
    expect(btn.querySelector("svg")).not.toBeNull();
  });

  it("forwards clicks to onActivate when active", async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(
      <CitationChip
        citationRef="x"
        active={true}
        onActivate={onActivate}
        tone="note"
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("is disabled (no onActivate fired) when active=false regardless of tone", async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(
      <CitationChip
        citationRef="x"
        active={false}
        onActivate={onActivate}
        tone="note"
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onActivate).not.toHaveBeenCalled();
  });
});
