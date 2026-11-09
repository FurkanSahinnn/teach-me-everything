import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownGfm } from "./index";

function nodesIn(doc: string): string[] {
  const state = EditorState.create({ doc, extensions: [markdownGfm()] });
  const tree = ensureSyntaxTree(state, state.doc.length, 5_000);
  const names: string[] = [];
  tree?.iterate({
    enter(node) {
      if (node.name === "Highlight" || node.name === "HighlightMark") {
        names.push(`${node.name}:${state.sliceDoc(node.from, node.to)}`);
      }
    },
  });
  return names;
}

describe("HighlightSyntax", () => {
  it("parses ==text== as a Highlight node with two marks", () => {
    expect(nodesIn("a ==vurgu== b")).toEqual([
      "Highlight:==vurgu==",
      "HighlightMark:==",
      "HighlightMark:==",
    ]);
  });

  it("ignores a single = and runs of three", () => {
    expect(nodesIn("x = y and ===no===")).toEqual([]);
  });

  it("does not open on a space-flanked delimiter", () => {
    expect(nodesIn("a == b == c")).toEqual([]);
  });

  it("nests with emphasis", () => {
    const names = nodesIn("==**kalın vurgu**==");
    expect(names[0]).toBe("Highlight:==**kalın vurgu**==");
  });
});
