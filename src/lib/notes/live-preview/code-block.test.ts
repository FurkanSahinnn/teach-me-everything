import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";

import {
  bodyRange,
  buildCodeBlockDecorations,
  codeBlockBodyText,
  findCodeBlocks,
  inlineLangPrefix,
} from "./code-block";

function makeState(doc: string, cursor = 0): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ extensions: [GFM] })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

type Item = { from: number; to: number; cls: string; ln: string | undefined; widget: boolean };

function items(set: DecorationSet): Item[] {
  const out: Item[] = [];
  const cursor = set.iter();
  while (cursor.value) {
    const spec = cursor.value.spec as {
      attributes?: Record<string, string>;
      widget?: unknown;
    };
    out.push({
      from: cursor.from,
      to: cursor.to,
      cls: spec.attributes?.class ?? "",
      ln: spec.attributes?.["data-ln"],
      widget: spec.widget !== undefined,
    });
    cursor.next();
  }
  return out;
}

const DOC = ["intro", "```python title:x hl:2", "a = 1", "b = 2", "```", "outro"].join("\n");

describe("findCodeBlocks", () => {
  it("locates fences, params and body", () => {
    const state = makeState(DOC);
    const [block] = findCodeBlocks(state);
    expect(block?.openLine).toBe(2);
    expect(block?.closeLine).toBe(5);
    expect(block?.params.language).toBe("python");
    expect(block?.params.title).toBe("x");
    expect(block && bodyRange(block)).toEqual({ first: 3, last: 4 });
    expect(block && codeBlockBodyText(state, block)).toBe("a = 1\nb = 2");
  });

  it("treats an unclosed fence as running to the end", () => {
    const state = makeState("```js\nlet a\nlet b");
    const [block] = findCodeBlocks(state);
    expect(block?.closeLine).toBeNull();
    expect(block && bodyRange(block)).toEqual({ first: 2, last: 3 });
  });

  it("skips fences nested in blockquotes", () => {
    expect(findCodeBlocks(makeState("> ```js\n> x\n> ```"))).toHaveLength(0);
  });
});

describe("buildCodeBlockDecorations", () => {
  const folds = new Map<number, boolean>();

  it("renders a header widget and hides the closing fence when the cursor is outside", () => {
    const set = items(buildCodeBlockDecorations(makeState(DOC, 0), { focused: true, folds }));
    expect(set.filter((i) => i.widget)).toHaveLength(1);
    const lines = set.filter((i) => i.cls);
    expect(lines).toHaveLength(4);
    expect(lines[0]?.cls).toContain("cm-tme-codeblock--header");
    expect(lines[3]?.cls).toContain("cm-tme-codeblock--hidden");
    expect(lines[2]?.cls).toContain("cm-tme-codeblock--last");
    expect(lines[1]?.ln).toBe("1");
    expect(lines[2]?.ln).toBe("2");
    expect(lines[2]?.cls).toContain("cm-tme-codeblock--hl");
    expect(lines[1]?.cls).not.toContain("cm-tme-codeblock--hl");
  });

  it("shows raw fences when the cursor is inside the block", () => {
    const set = items(buildCodeBlockDecorations(makeState(DOC, 25), { focused: true, folds }));
    expect(set.some((i) => i.widget)).toBe(false);
    expect(set.some((i) => i.cls.includes("--hidden"))).toBe(false);
    expect(set.filter((i) => i.cls.includes("--fence"))).toHaveLength(2);
  });

  it("renders everything when the editor is unfocused", () => {
    const set = items(buildCodeBlockDecorations(makeState(DOC, 25), { focused: false, folds }));
    expect(set.some((i) => i.widget)).toBe(true);
  });

  it("honours ln start offset and ln:false", () => {
    const a = items(
      buildCodeBlockDecorations(makeState("```js ln:27\nx\n```"), { focused: true, folds }),
    );
    expect(a.find((i) => i.ln)?.ln).toBe("27");
    const b = items(
      buildCodeBlockDecorations(makeState("```js ln:false\nx\n```"), { focused: true, folds }),
    );
    expect(b.some((i) => i.ln !== undefined)).toBe(false);
  });

  it("folds body and closing lines from the fold param and from user overrides", () => {
    const doc = "intro\n```js fold\nx\ny\n```";
    const state = makeState(doc);
    const folded = items(buildCodeBlockDecorations(state, { focused: true, folds }));
    expect(folded.filter((i) => i.cls.includes("--hidden"))).toHaveLength(3);
    expect(folded[0]?.cls).toContain("cm-tme-codeblock--last");

    const open = items(
      buildCodeBlockDecorations(state, { focused: true, folds: new Map([[6, false]]) }),
    );
    expect(open.filter((i) => i.cls.includes("--hidden"))).toHaveLength(1);
  });

  it("keeps only plain card styling for ignore blocks", () => {
    const set = items(
      buildCodeBlockDecorations(makeState("```js ignore title:x\nx\n```"), { focused: true, folds }),
    );
    expect(set.some((i) => i.widget)).toBe(false);
    expect(set.some((i) => i.ln !== undefined)).toBe(false);
    expect(set.some((i) => i.cls.includes("--hidden"))).toBe(false);
  });

  it("hides an inline {lang} prefix only on inactive lines", () => {
    const doc = "see `{python} print(1)` here\nnext";
    const off = items(buildCodeBlockDecorations(makeState(doc, doc.length), { focused: true, folds }));
    expect(off).toHaveLength(1);
    expect(doc.slice(off[0]?.from, off[0]?.to)).toBe("{python} ");
    const on = items(buildCodeBlockDecorations(makeState(doc, 6), { focused: true, folds }));
    expect(on).toHaveLength(0);
  });
});

describe("inlineLangPrefix", () => {
  it("detects the prefix and ignores plain code", () => {
    expect(inlineLangPrefix("`{js} x`")).toEqual({ ticks: 1, length: 5 });
    expect(inlineLangPrefix("`plain`")).toBeNull();
    expect(inlineLangPrefix("`{js}x`")).toBeNull();
  });
});
