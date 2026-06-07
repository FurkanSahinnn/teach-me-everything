import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { computeActiveLineNumbers } from "./cursor-aware";

function stateFor(doc: string, ranges: Array<[number, number] | number>): EditorState {
  return EditorState.create({
    doc,
    extensions: [EditorState.allowMultipleSelections.of(true)],
    selection: EditorSelection.create(
      ranges.map((r) => (typeof r === "number" ? EditorSelection.cursor(r) : EditorSelection.range(r[0], r[1]))),
    ),
  });
}

describe("computeActiveLineNumbers", () => {
  it("returns a single line for a cursor at the document start", () => {
    const state = stateFor("hello\nworld\n", [0]);
    expect([...computeActiveLineNumbers(state)]).toEqual([1]);
  });

  it("counts the line the cursor is parked on, even at column 0", () => {
    const state = stateFor("first\nsecond\nthird", [6]); // cursor at start of "second"
    expect([...computeActiveLineNumbers(state)]).toEqual([2]);
  });

  it("treats a cursor at end-of-line as the same line, not the next", () => {
    const state = stateFor("first\nsecond", [5]); // cursor right after "first"
    expect([...computeActiveLineNumbers(state)]).toEqual([1]);
  });

  it("captures every line spanned by a multi-line selection", () => {
    const state = stateFor("aaa\nbbb\nccc\nddd", [[2, 10]]); // mid of line 1 to mid of line 3
    expect([...computeActiveLineNumbers(state)]).toEqual([1, 2, 3]);
  });

  it("merges multi-cursor ranges and deduplicates lines", () => {
    const state = stateFor("aa\nbb\ncc\ndd", [1, 7, 10]); // line 1, line 3, line 4
    expect([...computeActiveLineNumbers(state)].sort((a, b) => a - b)).toEqual([1, 3, 4]);
  });

  it("returns an empty doc as line 1 active when the cursor is at 0", () => {
    const state = stateFor("", [0]);
    expect([...computeActiveLineNumbers(state)]).toEqual([1]);
  });
});
