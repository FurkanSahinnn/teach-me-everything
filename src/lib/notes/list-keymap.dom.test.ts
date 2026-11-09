import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdownGfm } from "./live-preview";
import { listAwareEnter } from "./list-keymap";

function pressEnter(doc: string, pos = doc.length): string {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(pos),
    extensions: [markdownGfm(), EditorState.tabSize.of(2)],
  });
  listAwareEnter({
    state,
    dispatch: (tr) => {
      state = tr.state;
    },
  });
  return state.doc.toString();
}

describe("listAwareEnter", () => {
  it("continues a bullet list with a new marker", () => {
    expect(pressEnter("- one")).toBe("- one\n- ");
  });

  it("continues a task list with an unchecked box", () => {
    expect(pressEnter("- [x] done")).toBe("- [x] done\n- [ ] ");
  });

  it("outdents an empty nested item one level instead of adding a stray blank line", () => {
    expect(pressEnter("- parent\n  - child\n  - ")).toBe("- parent\n  - child\n- ");
  });

  it("outdents an empty nested item written with a tab", () => {
    expect(pressEnter("- parent\n\t- ")).toBe("- parent\n- ");
  });

  it("ends the list with a blank line so the next paragraph is not swallowed by the last item", () => {
    expect(pressEnter("- one\n- ")).toBe("- one\n\n");
  });

  it("ends an empty top-level task item the same way", () => {
    expect(pressEnter("- [ ] a\n- [ ] ")).toBe("- [ ] a\n\n");
  });

  it("outdents an empty nested ordered item and renumbers it after its parent", () => {
    expect(pressEnter("1. first\n   1. ")).toBe("1. first\n2. ");
  });

  it("declines outside lists so the default Enter binding runs", () => {
    const state = EditorState.create({
      doc: "plain text",
      selection: EditorSelection.cursor(10),
      extensions: [markdownGfm()],
    });
    expect(listAwareEnter({ state, dispatch: () => {} })).toBe(false);
  });
});

describe("listKeymap precedence", () => {
  it("wins over the markdown language's own Enter binding in a real keymap stack", async () => {
    const { runScopeHandlers } = await import("@codemirror/view");
    const { EditorView } = await import("@codemirror/view");
    const { listKeymap } = await import("./list-keymap");
    const doc = "- parent\n  - child\n  - ";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.length),
        // Same order as NoteEditor: the language comes before the list keymap.
        extensions: [markdownGfm(), EditorState.tabSize.of(2), listKeymap],
      }),
    });
    runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Enter" }), "editor");
    expect(view.state.doc.toString()).toBe("- parent\n  - child\n- ");
    view.destroy();
  });
});

describe("listKeymap Enter on a code fence", () => {
  it("closes a freshly typed fence through the real keymap stack", async () => {
    const { runScopeHandlers, EditorView } = await import("@codemirror/view");
    const { listKeymap } = await import("./list-keymap");
    const doc = "Notes\n\n```js";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.length),
        extensions: [markdownGfm(), listKeymap],
      }),
    });
    runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Enter" }), "editor");
    expect(view.state.doc.toString()).toBe("Notes\n\n```js\n\n```");
    view.destroy();
  });
});
