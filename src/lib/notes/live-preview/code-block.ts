/**
 * Obsidian "Code Styler"-style fenced code for the live-preview editor.
 *
 * Every line of a `FencedCode` node becomes a card line (line decorations). When
 * the cursor is outside the block the opening fence is replaced by a header
 * widget and the closing fence is hidden; with the cursor inside, the raw fences
 * stay visible (still styled) so the params can be edited.
 *
 * Everything that hides lines or swaps them for widgets is produced by one
 * StateField: CodeMirror forbids those decorations from view plugins. Also,
 * `tr.state` is read inside the field update, so the field must be registered
 * after `sourceModeField` (index.ts does).
 */

import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";

import {
  type FenceParams,
  isLineHighlighted,
  parseFenceInfo,
} from "../code-styler/params";
import { computeActiveLineNumbers, isSourceModeActive } from "./cursor-aware";

// --- Pure block discovery ---------------------------------------------------

export type CodeBlock = {
  /** Document range of the whole FencedCode node. */
  from: number;
  to: number;
  /** 1-based line numbers. */
  openLine: number;
  closeLine: number | null;
  lastLine: number;
  params: FenceParams;
};

const OPEN_FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSE_FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** Lines of the block body (between the fences), as an inclusive 1-based range. */
export function bodyRange(block: CodeBlock): { first: number; last: number } {
  return {
    first: block.openLine + 1,
    last: block.closeLine === null ? block.lastLine : block.closeLine - 1,
  };
}

export function findCodeBlocks(state: EditorState): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const { doc } = state;
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const openLine = doc.lineAt(node.from);
      const open = OPEN_FENCE_RE.exec(openLine.text);
      // Fences nested in quotes or lists carry a prefix we cannot style safely.
      if (!open) return false;
      const lastLine = doc.lineAt(node.to);
      const closes =
        lastLine.number !== openLine.number &&
        CLOSE_FENCE_RE.test(lastLine.text);
      blocks.push({
        from: node.from,
        to: node.to,
        openLine: openLine.number,
        closeLine: closes ? lastLine.number : null,
        lastLine: lastLine.number,
        params: parseFenceInfo((open[2] ?? "").trim()),
      });
      return false;
    },
  });
  return blocks;
}

/** Body text without the fences, as the copy button copies it. */
export function codeBlockBodyText(state: EditorState, block: CodeBlock): string {
  const { first, last } = bodyRange(block);
  if (last < first) return "";
  return state.doc.sliceString(
    state.doc.line(first).from,
    state.doc.line(last).to,
  );
}

const INLINE_LANG_RE = /^(`+)(\{[A-Za-z0-9_+#.-]+\}[ \t])/;

/** Length of the `{lang} ` prefix after the opening backticks, or 0. */
export function inlineLangPrefix(codeText: string): { ticks: number; length: number } | null {
  const m = INLINE_LANG_RE.exec(codeText);
  if (!m) return null;
  return { ticks: (m[1] ?? "").length, length: (m[2] ?? "").length };
}

// --- Header widget ----------------------------------------------------------

class CodeHeaderWidget extends WidgetType {
  constructor(
    private readonly language: string,
    private readonly title: string | null,
    private readonly foldable: boolean,
    private readonly folded: boolean,
    private readonly placeholder: string | null,
  ) {
    super();
  }

  eq(other: CodeHeaderWidget): boolean {
    return (
      this.language === other.language &&
      this.title === other.title &&
      this.foldable === other.foldable &&
      this.folded === other.folded &&
      this.placeholder === other.placeholder
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-tme-codeblock-header";
    // Keep the editor's selection and focus: the header is chrome, not text.
    root.addEventListener("mousedown", (e) => e.preventDefault());

    if (this.foldable) {
      const chevron = document.createElement("span");
      chevron.className = "cm-tme-codeblock-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.dataset.folded = String(this.folded);
      root.appendChild(chevron);
      root.setAttribute("role", "button");
      root.setAttribute(
        "aria-label",
        view.state.phrase(this.folded ? "Expand" : "Collapse"),
      );
      root.setAttribute("aria-expanded", String(!this.folded));
    }
    if (this.language) {
      const lang = document.createElement("span");
      lang.className = "cm-tme-codeblock-lang";
      lang.textContent = this.language;
      root.appendChild(lang);
    }
    if (this.title) {
      const title = document.createElement("span");
      title.className = "cm-tme-codeblock-title";
      title.textContent = this.title;
      root.appendChild(title);
    }
    if (this.folded) {
      const ph = document.createElement("span");
      ph.className = "cm-tme-codeblock-placeholder";
      ph.textContent = this.placeholder ?? view.state.phrase("Collapsed code");
      root.appendChild(ph);
    }

    const spacer = document.createElement("span");
    spacer.className = "cm-tme-codeblock-spacer";
    root.appendChild(spacer);

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "cm-tme-codeblock-copy";
    const copyLabel = view.state.phrase("Copy code");
    copy.textContent = copyLabel;
    copy.title = copyLabel;
    copy.addEventListener("click", (e) => {
      e.stopPropagation();
      const block = blockAtHeader(view, root);
      if (!block) return;
      void navigator.clipboard
        ?.writeText(codeBlockBodyText(view.state, block))
        .then(() => {
          copy.textContent = view.state.phrase("Copied");
          copy.dataset.copied = "true";
          setTimeout(() => {
            copy.textContent = copyLabel;
            delete copy.dataset.copied;
          }, COPIED_RESET_MS);
        })
        .catch(() => {
          /* Clipboard can be denied; the button simply stays in its idle state. */
        });
    });
    root.appendChild(copy);

    root.addEventListener("click", () => {
      if (!this.foldable) return;
      const block = blockAtHeader(view, root);
      if (!block) return;
      const from = view.state.doc.line(block.openLine).from;
      view.dispatch({
        effects: setCodeFoldEffect.of({ pos: from, folded: !this.folded }),
      });
    });
    // Double click drops the cursor on the fence so its params can be edited.
    root.addEventListener("dblclick", () => {
      const block = blockAtHeader(view, root);
      if (!block) return;
      view.dispatch({
        selection: { anchor: view.state.doc.line(block.openLine).to },
      });
      view.focus();
    });
    return root;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const COPIED_RESET_MS = 1500;

function blockAtHeader(view: EditorView, dom: HTMLElement): CodeBlock | null {
  const pos = view.posAtDOM(dom);
  const lineNo = view.state.doc.lineAt(pos).number;
  return findCodeBlocks(view.state).find((b) => b.openLine === lineNo) ?? null;
}

// --- State ------------------------------------------------------------------

/** Explicit fold choice for the block whose opening line starts at `pos`. */
export const setCodeFoldEffect = StateEffect.define<{ pos: number; folded: boolean }>({
  map: (value, mapping) => ({ pos: mapping.mapPos(value.pos, -1), folded: value.folded }),
});

const codeFocusEffect = StateEffect.define<boolean>();

type CodeBlockState = {
  focused: boolean;
  /** User toggles by opening-line start; falls back to the `fold` param. */
  folds: ReadonlyMap<number, boolean>;
  decorations: DecorationSet;
};

export type BuildOptions = {
  focused: boolean;
  folds: ReadonlyMap<number, boolean>;
};

function classesFor(parts: Array<string | false>): string {
  return parts.filter(Boolean).join(" ");
}

export function buildCodeBlockDecorations(
  state: EditorState,
  opts: BuildOptions,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const { doc } = state;
  const sel = state.selection.ranges;

  for (const block of findCodeBlocks(state)) {
    const params = block.params;
    const inside =
      opts.focused && sel.some((r) => r.from <= block.to && r.to >= block.from);
    const closed = block.closeLine !== null;
    const rendered = !params.ignore && !inside;
    const body = bodyRange(block);
    const hasBody = body.last >= body.first;
    const foldable = rendered && closed && hasBody;
    const openFrom = doc.line(block.openLine).from;
    const folded = foldable && (opts.folds.get(openFrom) ?? params.fold);
    const hidesClose = rendered && closed;

    // Last line that stays visible, so the card's bottom corners land on it.
    let visibleLast = block.lastLine;
    if (folded) visibleLast = block.openLine;
    else if (hidesClose) visibleLast = hasBody ? body.last : block.openLine;

    for (let n = block.openLine; n <= block.lastLine; n++) {
      const line = doc.line(n);
      const isOpen = n === block.openLine;
      const isClose = n === block.closeLine;
      const isBody = n >= body.first && n <= body.last;
      const hidden = (folded && !isOpen) || (hidesClose && isClose);
      const index = n - body.first + 1;
      const showNumbers = !params.ignore && params.lineNumbers && isBody;
      const highlighted =
        !params.ignore && isBody && isLineHighlighted(params, index, line.text);
      const cls = classesFor([
        "cm-tme-codeblock",
        isOpen && "cm-tme-codeblock--first",
        n === visibleLast && "cm-tme-codeblock--last",
        isOpen && rendered && "cm-tme-codeblock--header",
        (isOpen || isClose) && !rendered && "cm-tme-codeblock--fence",
        showNumbers && "cm-tme-codeblock--numbered",
        highlighted && "cm-tme-codeblock--hl",
        isBody && params.wrap === false && "cm-tme-codeblock--nowrap",
        hidden && "cm-tme-codeblock--hidden",
      ]);
      const attributes: Record<string, string> = { class: cls };
      if (showNumbers) attributes["data-ln"] = String(params.lineStart + index - 1);
      ranges.push(Decoration.line({ attributes }).range(line.from));
    }

    if (rendered) {
      const openLine = doc.line(block.openLine);
      ranges.push(
        Decoration.replace({
          widget: new CodeHeaderWidget(
            params.language,
            params.title,
            foldable,
            folded,
            params.foldPlaceholder,
          ),
        }).range(openLine.from, openLine.to),
      );
    }
  }

  addInlineLangPrefixes(state, opts.focused, ranges);
  return Decoration.set(ranges, true);
}

/** Hides the `{python} ` prefix of `` `{python} code` `` on inactive lines. */
function addInlineLangPrefixes(
  state: EditorState,
  focused: boolean,
  out: Range<Decoration>[],
): void {
  const active = computeActiveLineNumbers(state, { focused });
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "InlineCode") return;
      const prefix = inlineLangPrefix(state.doc.sliceString(node.from, node.to));
      if (!prefix) return false;
      if (active.has(state.doc.lineAt(node.from).number)) return false;
      const from = node.from + prefix.ticks;
      out.push(Decoration.replace({}).range(from, from + prefix.length));
      return false;
    },
  });
}

const codeBlockField = StateField.define<CodeBlockState>({
  create(state) {
    const folds = new Map<number, boolean>();
    return {
      focused: false,
      folds,
      decorations: isSourceModeActive(state)
        ? Decoration.none
        : buildCodeBlockDecorations(state, { focused: false, folds }),
    };
  },
  update(value, tr) {
    let { focused, folds } = value;
    let changedState = false;
    if (tr.docChanged && folds.size > 0) {
      const mapped = new Map<number, boolean>();
      for (const [pos, folded] of folds) mapped.set(tr.changes.mapPos(pos, -1), folded);
      folds = mapped;
    }
    for (const effect of tr.effects) {
      if (effect.is(codeFocusEffect)) {
        focused = effect.value;
        changedState = true;
      } else if (effect.is(setCodeFoldEffect)) {
        const next = new Map(folds);
        next.set(effect.value.pos, effect.value.folded);
        folds = next;
        changedState = true;
      }
    }
    const sourceChanged =
      isSourceModeActive(tr.startState) !== isSourceModeActive(tr.state);
    if (
      !changedState &&
      !sourceChanged &&
      !tr.docChanged &&
      !tr.selection &&
      syntaxTree(tr.startState) === syntaxTree(tr.state)
    ) {
      return value;
    }
    return {
      focused,
      folds,
      decorations: isSourceModeActive(tr.state)
        ? Decoration.none
        : buildCodeBlockDecorations(tr.state, { focused, folds }),
    };
  },
  provide: (field) => EditorView.decorations.from(field, (v) => v.decorations),
});

// --- Theme ------------------------------------------------------------------

const MONO = "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";
const HL_BG = "color-mix(in srgb, var(--color-accent) 14%, transparent)";

const codeBlockTheme = EditorView.theme({
  ".cm-line.cm-tme-codeblock": {
    position: "relative",
    fontFamily: MONO,
    fontSize: "0.9em",
    lineHeight: "1.6",
    backgroundColor: "var(--md-code-bg)",
    color: "var(--md-code-fg)",
    borderLeft: "1px solid var(--md-code-border)",
    borderRight: "1px solid var(--md-code-border)",
    padding: "0 14px",
  },
  ".cm-line.cm-tme-codeblock--first": {
    borderTop: "1px solid var(--md-code-border)",
    borderTopLeftRadius: "8px",
    borderTopRightRadius: "8px",
    paddingTop: "4px",
  },
  ".cm-line.cm-tme-codeblock--last": {
    borderBottom: "1px solid var(--md-code-border)",
    borderBottomLeftRadius: "8px",
    borderBottomRightRadius: "8px",
    paddingBottom: "4px",
  },
  ".cm-line.cm-tme-codeblock--fence": {
    color: "var(--md-code-muted)",
  },
  ".cm-line.cm-tme-codeblock--header": {
    padding: "0 10px",
    borderBottom: "1px solid var(--md-code-border)",
  },
  ".cm-line.cm-tme-codeblock--header.cm-tme-codeblock--last": {
    borderBottom: "1px solid var(--md-code-border)",
  },
  ".cm-line.cm-tme-codeblock--hidden": {
    display: "none",
  },
  ".cm-line.cm-tme-codeblock--numbered": {
    paddingLeft: "3.6em",
  },
  ".cm-line.cm-tme-codeblock--numbered::before": {
    content: "attr(data-ln)",
    position: "absolute",
    left: "0",
    width: "2.6em",
    textAlign: "right",
    color: "var(--md-code-muted)",
    userSelect: "none",
    pointerEvents: "none",
  },
  ".cm-line.cm-tme-codeblock--hl": {
    backgroundImage: `linear-gradient(${HL_BG}, ${HL_BG})`,
    boxShadow: "inset 3px 0 0 var(--color-accent)",
  },
  ".cm-line.cm-tme-codeblock--nowrap": {
    whiteSpace: "pre",
    overflowX: "auto",
  },

  // inline-flex, not flex: the header sits inside a .cm-line between CM's
  // zero-width widget buffers; a block box pushes them onto their own rows
  // and triples the header's height.
  ".cm-tme-codeblock-header": {
    display: "inline-flex",
    width: "100%",
    boxSizing: "border-box",
    verticalAlign: "top",
    alignItems: "center",
    gap: "8px",
    minHeight: "28px",
    color: "var(--md-code-muted)",
    fontFamily: MONO,
    cursor: "default",
    userSelect: "none",
  },
  ".cm-tme-codeblock-header[role=button]": {
    cursor: "pointer",
  },
  ".cm-tme-codeblock-chevron": {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRight: "1.5px solid currentColor",
    borderBottom: "1.5px solid currentColor",
    transform: "rotate(45deg)",
    transition: "transform 150ms ease",
    marginRight: "2px",
  },
  ".cm-tme-codeblock-chevron[data-folded=true]": {
    transform: "rotate(-45deg)",
  },
  ".cm-tme-codeblock-lang": {
    fontSize: "0.75em",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  ".cm-tme-codeblock-title": {
    color: "var(--md-code-fg)",
    fontSize: "0.9em",
  },
  ".cm-tme-codeblock-placeholder": {
    fontStyle: "italic",
    fontSize: "0.9em",
  },
  ".cm-tme-codeblock-spacer": {
    flex: "1 1 auto",
  },
  ".cm-tme-codeblock-copy": {
    border: "1px solid var(--md-code-border)",
    borderRadius: "6px",
    background: "transparent",
    color: "var(--md-code-muted)",
    fontFamily: "inherit",
    fontSize: "0.75em",
    padding: "1px 8px",
    cursor: "pointer",
  },
  ".cm-tme-codeblock-copy:hover": {
    color: "var(--md-code-fg)",
    borderColor: "var(--color-accent)",
  },
  ".cm-tme-codeblock-copy[data-copied=true]": {
    color: "var(--color-accent)",
    borderColor: "var(--color-accent)",
  },
});

export function codeBlockExtension(): Extension {
  return [
    codeBlockField,
    EditorView.focusChangeEffect.of((_state, focusing) => codeFocusEffect.of(focusing)),
    codeBlockTheme,
  ];
}
