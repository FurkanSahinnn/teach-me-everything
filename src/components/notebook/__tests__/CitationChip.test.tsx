import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CitationChip } from "../CitationChip";

afterEach(() => {
  cleanup();
});

describe("CitationChip (Phase 6.9.7 — note tone)", () => {
  it("renders the default § marker when tone is unset", () => {
    render(
      <CitationChip ref="2.3" active={true} onActivate={() => {}} />,
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
        ref="learning-log"
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
        ref="x"
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
        ref="x"
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
