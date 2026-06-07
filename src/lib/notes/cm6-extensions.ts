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
    fontFamily:
      "var(--font-body, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif)",
    fontSize: "15px",
    height: "100%",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.65",
    padding: "8px 0",
  },
  ".cm-content": {
    caretColor: "var(--color-accent)",
    padding: "12px 16px",
  },
  ".cm-line": {
    padding: "0 4px",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--color-accent)",
    borderLeftWidth: "2px",
  },
  "&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground": {
    backgroundColor: "var(--color-accent-wash, rgba(184, 106, 43, 0.18))",
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
});
