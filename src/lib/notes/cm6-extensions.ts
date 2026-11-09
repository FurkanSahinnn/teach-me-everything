/**
 * Engine-level CodeMirror 6 extensions for the notes editor:
 *   - `countWords` (pure, exported for tests)
 *   - `createDebouncedSaver` (pure, exported for tests)
 *   - `autosaveExtension` — debounces doc changes and calls `onSave(doc)`
 *   - `wordCountExtension` — emits the running word count on every change
 *   - `editorBaseTheme` — bridges CM6 internals to TME design tokens
 *
 * Toolbar / formatting commands live in `toolbar-commands.ts`. Live-preview
 * widgets and the cursor-aware compartment land in Phase 6.3 — keep this
 * module orthogonal to those.
 */

import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export const DEFAULT_AUTOSAVE_MS = 800;

/**
 * Approximate word count for a markdown document. Strips fenced code blocks,
 * inline code, link markup, wikilink target syntax, and inline emphasis
 * markers before tokenizing on whitespace. Designed for a status-bar counter,
 * not for billing — accuracy is "close enough", not exact.
 */
export function countWords(markdown: string): number {
  if (!markdown) return 0;

  let text = markdown.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/`[^`\n]+`/g, " ");
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, " $1 ");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) =>
    (alias ?? target) as string,
  );
  text = text.replace(/^[ \t]*(#{1,6}|>)\s+/gm, "");
  text = text.replace(/^[ \t]*([-*+]|\d+\.)\s+/gm, "");
  text = text.replace(/^\[[ xX]\]\s+/gm, "");
  text = text.replace(/[*_~]+/g, "");

  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export type DebouncedSaver<T> = {
  /** Reset the timer and remember the latest value to save. */
  schedule(value: T): void;
  /** Cancel any pending timer and invoke `saveFn` immediately with the last value. */
  flush(): Promise<void>;
  /** Cancel any pending timer without saving. */
  cancel(): void;
  /** True iff a save is queued. */
  pending(): boolean;
};

/**
 * Tiny debounced saver: every `schedule(v)` resets the timer; after `delayMs`
 * of inactivity, `saveFn(latest)` runs once. `flush` and `cancel` allow the
 * editor to commit pending edits on teardown or reset on external prop sync.
 */
export function createDebouncedSaver<T>(
  saveFn: (value: T) => void | Promise<void>,
  delayMs: number,
): DebouncedSaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastValue: T | undefined;
  let hasPending = false;

  function clear(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    schedule(value) {
      lastValue = value;
      hasPending = true;
      clear();
      timer = setTimeout(() => {
        timer = null;
        hasPending = false;
        void Promise.resolve(saveFn(value));
      }, delayMs);
    },
    async flush() {
      if (!hasPending) return;
      clear();
      hasPending = false;
      await Promise.resolve(saveFn(lastValue as T));
    },
    cancel() {
      clear();
      hasPending = false;
    },
    pending() {
      return hasPending;
    },
  };
}

export type AutosaveOptions = {
  onSave: (doc: string) => void | Promise<void>;
  delayMs?: number;
};

/**
 * Builds a CM6 `ViewPlugin` that debounces document changes and calls
 * `onSave(doc)` after the user pauses typing.
 *
 * On `destroy` the saver is flushed so an in-flight edit isn't lost when the
 * editor unmounts (route change, note swap, etc.).
 */
export function autosaveExtension(opts: AutosaveOptions) {
  const delayMs = opts.delayMs ?? DEFAULT_AUTOSAVE_MS;
  return ViewPlugin.define(() => {
    const saver = createDebouncedSaver<string>(opts.onSave, delayMs);
    return {
      update(update: ViewUpdate) {
        if (update.docChanged) {
          saver.schedule(update.state.doc.toString());
        }
      },
      destroy() {
        void saver.flush();
      },
    };
  });
}

export type WordCountOptions = {
  onUpdate: (count: number) => void;
};

/**
 * Builds a CM6 `ViewPlugin` that recomputes word count on every doc change
 * and reports the new value via `onUpdate`. Initial count is emitted once on
 * mount. Subsequent emits are suppressed if the count is unchanged.
 */
export function wordCountExtension(opts: WordCountOptions) {
  return ViewPlugin.define((view) => {
    let lastCount = countWords(view.state.doc.toString());
    opts.onUpdate(lastCount);
    return {
      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        const next = countWords(update.state.doc.toString());
        if (next !== lastCount) {
          lastCount = next;
          opts.onUpdate(next);
        }
      },
    };
  });
}

/**
 * Base theme that maps CM6 internals to TME design tokens. Live-preview-specific
 * styling (heading scale, inline marks) lives in Phase 6.3 — this theme stays
 * intentionally plain: paper background, ink text, serif heading fallback,
 * accent caret/selection.
 */
export const editorBaseTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--color-ink)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--tme-editor-font-size, 16px)",
    height: "100%",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.7",
    padding: "0",
  },
  // Readable line length: the width slider sets --tme-editor-width on the
  // host; the content column centres inside whatever room the pane has.
  ".cm-content": {
    caretColor: "var(--color-accent)",
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "var(--tme-editor-width, 760px)",
    margin: "0 auto",
    padding: "28px 40px 45vh",
  },
  ".cm-line": {
    padding: "0 2px",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-accent)",
    borderLeftWidth: "2px",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "color-mix(in srgb, var(--color-accent) 26%, transparent)",
    },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  ".cm-gutters": {
    display: "none",
  },
  ".cm-placeholder": {
    color: "var(--color-ink-4)",
    fontStyle: "italic",
  },

  // ---- tooltips (wikilink autocomplete, hover) follow the active theme
  ".cm-tooltip": {
    backgroundColor: "var(--color-paper)",
    color: "var(--color-ink)",
    border: "1px solid var(--color-rule)",
    borderRadius: "10px",
    boxShadow: "var(--shadow-deep)",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-sans)",
    maxHeight: "18rem",
    minWidth: "260px",
    padding: "4px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "baseline",
    gap: "8px",
    padding: "6px 10px",
    borderRadius: "6px",
    lineHeight: "1.35",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--color-accent-wash)",
    color: "var(--color-ink)",
  },
  ".cm-completionLabel": {
    fontSize: "13.5px",
  },
  ".cm-completionDetail": {
    marginLeft: "auto",
    fontStyle: "normal",
    fontSize: "11px",
    color: "var(--color-ink-4)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  ".cm-completionMatchedText": {
    textDecoration: "none",
    color: "var(--color-accent)",
    fontWeight: "600",
  },

  // ---- search / replace panel
  ".cm-panels": {
    backgroundColor: "var(--color-paper-2)",
    color: "var(--color-ink)",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--color-rule)",
  },
  ".cm-panels.cm-panels-bottom": {
    borderTop: "1px solid var(--color-rule)",
  },
  ".cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
    padding: "8px 12px",
    fontFamily: "var(--font-sans)",
    fontSize: "12.5px",
  },
  ".cm-search br": {
    flexBasis: "100%",
    height: "0",
  },
  ".cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    color: "var(--color-ink-3)",
  },
  ".cm-textfield": {
    backgroundColor: "var(--color-paper)",
    color: "var(--color-ink)",
    border: "1px solid var(--color-rule)",
    borderRadius: "6px",
    padding: "4px 8px",
    fontSize: "13px",
    outline: "none",
  },
  ".cm-textfield:focus": {
    borderColor: "var(--color-accent)",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--color-paper-3)",
    color: "var(--color-ink-2)",
    border: "1px solid var(--color-rule)",
    borderRadius: "6px",
    padding: "3px 9px",
    fontSize: "12px",
    cursor: "pointer",
  },
  ".cm-button:hover": {
    color: "var(--color-ink)",
    borderColor: "var(--color-rule-strong)",
  },
  ".cm-search button[name=close]": {
    marginLeft: "auto",
    background: "none",
    border: "none",
    color: "var(--color-ink-3)",
    fontSize: "18px",
    cursor: "pointer",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--color-warn) 28%, transparent)",
    borderRadius: "2px",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, var(--color-warn) 55%, transparent)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 14%, transparent)",
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "transparent",
    outline: "1px solid var(--color-rule-strong)",
    borderRadius: "2px",
  },
});
