import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { fenceAwareEnter } from "./fence-enter";

function enterAt(doc: string, pos: number): { handled: boolean; doc: string; cursor: number } {
  let state = EditorState.create({ doc, selection: EditorSelection.cursor(pos) });
  const handled = fenceAwareEnter({
    state,
    dispatch: (tr) => {
      state = tr.state;
    },
  });
  return { handled, doc: state.doc.toString(), cursor: state.selection.main.head };
}

describe("fenceAwareEnter", () => {
  it("closes a freshly typed fence and puts the caret inside the block", () => {
    const r = enterAt("```", 3);
    expect(r.handled).toBe(true);
    expect(r.doc).toBe("```\n\n```");
    expect(r.cursor).toBe(4);
  });

  it("keeps the language on the opening fence", () => {
    expect(enterAt("Text\n\n```python", 15).doc).toBe("Text\n\n```python\n\n```");
  });

  it("closes tilde fences with tildes of the same length", () => {
    expect(enterAt("~~~~", 4).doc).toBe("~~~~\n\n~~~~");
  });

  it("keeps the following paragraph out of the new block", () => {
    expect(enterAt("```\nafter", 3).doc).toBe("```\n\n```\nafter");
  });

  it("closes a new fence typed above an existing, closed block", () => {
    const doc = "```\n\ntext\n\n```js\nx\n```";
    expect(enterAt(doc, 3).doc).toBe("```\n\n```\n\ntext\n\n```js\nx\n```");
  });

  it("leaves Enter alone on the opening line of a block that is already closed", () => {
    expect(enterAt("```js\ncode\n```", 5).handled).toBe(false);
  });

  it("leaves Enter alone on a closing fence", () => {
    expect(enterAt("```\ncode\n```", 12).handled).toBe(false);
  });

  it("leaves Enter alone when the caret is not at the end of the fence line", () => {
    expect(enterAt("```py", 1).handled).toBe(false);
  });
});
