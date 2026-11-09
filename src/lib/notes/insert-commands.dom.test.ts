import { beforeAll, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  buildTableMarkdown,
  insertCallout,
  insertCodeBlock,
  insertFootnote,
  insertHorizontalRule,
  insertTable,
  nextFootnoteId,
  wrapInCallout,
} from "./insert-commands";

// jsdom has no layout engine; CodeMirror measures text ranges after a
// scrollIntoView transaction, so give Range the empty rect APIs it expects.
beforeAll(() => {
  const emptyRects = (): DOMRectList =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects = emptyRects;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

function viewWith(doc: string, anchor: number, head = anchor): EditorView {
  const state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
  return new EditorView({ state, parent: document.createElement("div") });
}

describe("buildTableMarkdown", () => {
  it("builds a header, a divider and empty body rows", () => {
    expect(buildTableMarkdown(2, 2, (i) => `Col ${i}`)).toBe(
      "| Col 1 | Col 2 |\n| --- | --- |\n|   |   |\n|   |   |",
    );
  });

  it("clamps absurd sizes", () => {
    const md = buildTableMarkdown(999, 0, () => "H");
    expect(md.split("\n")).toHaveLength(22);
  });
});

describe("nextFootnoteId", () => {
  it("returns the first unused number", () => {
    expect(nextFootnoteId("a[^1] b[^2] [^1]: x")).toBe(3);
    expect(nextFootnoteId("a[^2]")).toBe(1);
  });
});

describe("wrapInCallout", () => {
  it("prefixes every line and keeps blank lines inside the callout", () => {
    expect(wrapInCallout("one\n\ntwo", "tip", "")).toBe("> [!tip]\n> one\n>\n> two");
  });
});

describe("block inserts", () => {
  it("puts a table after the current paragraph instead of splitting it", () => {
    const view = viewWith("Some text", 4);
    insertTable(view, 1, 2, (i) => `H${i}`);
    expect(view.state.doc.toString()).toBe("Some text\n\n| H1 | H2 |\n| --- | --- |\n|   |   |\n");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      "H1",
    );
  });

  it("wraps the selected lines in a callout", () => {
    const view = viewWith("alpha\nbeta", 0, 10);
    insertCallout(view, "warning");
    expect(view.state.doc.toString()).toBe("> [!warning]\n> alpha\n> beta\n");
  });

  it("inserts an empty fence on an empty line with the caret on the info string", () => {
    const view = viewWith("", 0);
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe("```\n\n```\n");
    expect(view.state.selection.main.head).toBe(3);
  });

  it("inserts a rule on its own line", () => {
    const view = viewWith("a\n", 2);
    insertHorizontalRule(view);
    expect(view.state.doc.toString()).toBe("a\n---\n\n");
  });

  it("adds a footnote reference and its definition at the end", () => {
    const view = viewWith("Claim.", 5);
    insertFootnote(view);
    expect(view.state.doc.toString()).toBe("Claim[^1].\n\n[^1]: ");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });
});
