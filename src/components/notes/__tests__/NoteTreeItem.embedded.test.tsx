import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NoteTreeItem } from "../NoteTreeItem";

afterEach(() => {
  cleanup();
});

const noopHandlers = {
  onClick: () => {},
  onContextMenu: () => {},
  onMenuButtonClick: () => {},
  onDragStart: () => {},
  onDragOver: () => {},
  onDragLeave: () => {},
  onDrop: () => {},
};

const labels = {
  expand: "Expand",
  collapse: "Collapse",
  openMenu: "Open menu",
  untitledNote: "Untitled",
  untitledFolder: "Untitled folder",
  renameSave: "Save",
  renameCancel: "Cancel",
  embeddedTooltip: "Embedded as source",
};

describe("NoteTreeItem embedded dot (Phase 6.9.8)", () => {
  it("renders the Sparkles dot when variant='note' and embedded=true", () => {
    render(
      <NoteTreeItem
        variant="note"
        id="nt-1"
        label="My note"
        depth={0}
        embedded={true}
        labels={labels}
        {...noopHandlers}
      />,
    );
    const dot = screen.getByTestId("tree-embedded-dot-nt-1");
    expect(dot).toHaveAttribute("data-embedded", "true");
    expect(dot).toHaveAttribute("title", "Embedded as source");
    expect(dot.querySelector("svg")).not.toBeNull();
  });

  it("omits the Sparkles dot when embedded is false (or unset)", () => {
    render(
      <NoteTreeItem
        variant="note"
        id="nt-2"
        label="Plain note"
        depth={0}
        labels={labels}
        {...noopHandlers}
      />,
    );
    expect(screen.queryByTestId("tree-embedded-dot-nt-2")).toBeNull();
  });

  it("never renders the dot on folder rows even when embedded=true is forced", () => {
    // Defensive: folders carry no note-source linkage. The component must
    // not light up the dot for the folder variant regardless of caller
    // mistake.
    render(
      <NoteTreeItem
        variant="folder"
        id="fd-1"
        label="My folder"
        depth={0}
        embedded={true}
        labels={labels}
        {...noopHandlers}
      />,
    );
    expect(screen.queryByTestId("tree-embedded-dot-fd-1")).toBeNull();
  });
});
