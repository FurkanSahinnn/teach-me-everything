/**
 * Phase 6.3 — Public entry for the notes live-preview extension.
 *
 * Combines every widget module into a single `ViewPlugin` that runs once per
 * viewport / doc / selection change, producing a unified `DecorationSet`.
 * Source-mode toggle is wired here too — `Mod-e` flips a state field, and
 * the plugin short-circuits to `Decoration.none` while the field is true so
 * the editor reads as raw markdown without losing decoration scaffolding.
 *
 * GFM extension is enabled inside the markdown configuration so the Lezer
 * tree carries `Strikethrough`, `Task`, and `Table` nodes that the rest of
 * the pipeline relies on.
 *
 * Theme styling lives in `livePreviewTheme` below. It cascades on top of the
 * `editorBaseTheme` from Phase 6.2 — no overlap, only additions.
 */

import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import type { Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import {
  computeActiveLineNumbers,
  isSourceModeActive,
  sourceModeField,
  sourceModeKeymap,
  sourceModeNotifier,
} from "./cursor-aware";
import { buildHeadingDecorations } from "./heading-widget";
import { buildInlineMarkDecorations } from "./inline-marks";
import { buildListDecorations } from "./list-widgets";
import { buildTagDecorations } from "./tag-widget";
import type { DecoSpec } from "./types";
import { buildWikilinkDecorations } from "./wikilink-widget";

export {
  setSourceMode,
  isSourceModeActive,
  sourceModeField,
  toggleSourceModeEffect,
} from "./cursor-aware";
export type {
  WikilinkClickDetail,
  CheckboxToggleDetail,
  TagClickDetail,
} from "./types";
export { TME_EVENT } from "./types";

export type LivePreviewOptions = {
  /**
   * Fires whenever the source-mode boolean flips. Used by the React shell
   * to update its footer pill. Receives the new active state.
   */
  onSourceModeChange?: (active: boolean) => void;
};

/**
 * Markdown language extension preconfigured with the GitHub-Flavored
 * Markdown grammar additions (Tables, TaskList, Strikethrough, Autolinks).
 * Use this in place of the bare `markdown()` call from Phase 6.2.
 */
export function markdownGfm(): Extension {
  return markdown({ extensions: GFM });
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      const sourceModeBefore = update.startState.field(sourceModeField, false) ?? false;
      const sourceModeAfter = update.state.field(sourceModeField, false) ?? false;
      const sourceModeChanged = sourceModeBefore !== sourceModeAfter;

      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        sourceModeChanged
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

function buildDecorations(view: EditorView): DecorationSet {
  if (isSourceModeActive(view.state)) return Decoration.none;

  const activeLines = computeActiveLineNumbers(view.state);
  const specs: DecoSpec[] = [];

  for (const { from, to } of view.visibleRanges) {
    buildHeadingDecorations(view.state, activeLines, from, to, specs);
    buildInlineMarkDecorations(view.state, activeLines, from, to, specs);
    buildWikilinkDecorations(view.state, activeLines, from, to, specs);
    buildTagDecorations(view.state, activeLines, from, to, specs);
    buildListDecorations(view.state, activeLines, from, to, specs);
  }

  if (specs.length === 0) return Decoration.none;

  const ranges = specs.map(({ from, to, deco }) => deco.range(from, to));
  // `Decoration.set` sorts by (from, side) when the second argument is true,
  // letting individual widget modules push in any order without coordinating.
  return Decoration.set(ranges, true);
}

const livePreviewTheme = EditorView.theme({
  // --- Heading scale ---
  ".cm-tme-h1, .cm-tme-h2, .cm-tme-h3, .cm-tme-h4, .cm-tme-h5, .cm-tme-h6": {
    fontFamily:
      "var(--font-display, ui-serif, Georgia, 'Times New Roman', serif)",
    fontWeight: "600",
    color: "var(--color-ink)",
    letterSpacing: "-0.01em",
  },
  ".cm-tme-h1": {
    fontSize: "1.85em",
    lineHeight: "1.25",
    paddingTop: "0.35em",
    paddingBottom: "0.15em",
  },
  ".cm-tme-h2": {
    fontSize: "1.5em",
    lineHeight: "1.3",
    paddingTop: "0.3em",
    paddingBottom: "0.1em",
  },
  ".cm-tme-h3": {
    fontSize: "1.25em",
    lineHeight: "1.35",
    paddingTop: "0.25em",
    paddingBottom: "0.05em",
  },
  ".cm-tme-h4": {
    fontSize: "1.1em",
    lineHeight: "1.4",
  },
  ".cm-tme-h5": {
    fontSize: "1em",
    lineHeight: "1.45",
    color: "var(--color-ink-2)",
  },
  ".cm-tme-h6": {
    fontSize: "0.92em",
    lineHeight: "1.5",
    color: "var(--color-ink-3)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },

  // --- Inline marks ---
  ".cm-tme-strong": {
    fontWeight: "700",
    color: "var(--color-ink)",
  },
  ".cm-tme-em": {
    fontStyle: "italic",
  },
  ".cm-tme-strike": {
    textDecoration: "line-through",
    textDecorationThickness: "1.5px",
    color: "var(--color-ink-3)",
  },
  ".cm-tme-code": {
    fontFamily:
      "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    fontSize: "0.9em",
    backgroundColor: "var(--color-paper-3)",
    color: "var(--color-accent-ink)",
    padding: "1px 5px",
    borderRadius: "4px",
    border: "1px solid var(--color-rule-soft)",
  },
  ".cm-tme-link": {
    color: "var(--color-accent)",
    textDecoration: "underline",
    textDecorationStyle: "dotted",
    textDecorationThickness: "1px",
    textUnderlineOffset: "3px",
    cursor: "pointer",
  },

  // --- Wikilink chip ---
  ".cm-tme-wikilink": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "1px 9px 1px 7px",
    backgroundColor: "var(--color-accent-wash)",
    color: "var(--color-accent-ink)",
    border: "1px solid var(--color-accent-soft)",
    borderRadius: "999px",
    fontSize: "0.93em",
    fontWeight: "500",
    cursor: "pointer",
    lineHeight: "1.4",
    transition: "background-color 150ms ease, border-color 150ms ease, transform 150ms ease",
    verticalAlign: "baseline",
    textDecoration: "none",
    userSelect: "none",
  },
  ".cm-tme-wikilink:hover": {
    backgroundColor: "var(--color-accent-soft)",
    borderColor: "var(--color-accent)",
  },
  ".cm-tme-wikilink:active": {
    transform: "translateY(0.5px)",
  },
  ".cm-tme-wikilink:focus-visible": {
    outline: "2px solid var(--color-accent)",
    outlineOffset: "2px",
  },
  ".cm-tme-wikilink--source": {
    backgroundColor: "color-mix(in srgb, var(--color-slate) 10%, var(--color-paper))",
    borderColor: "color-mix(in srgb, var(--color-slate) 35%, var(--color-rule-strong))",
    color: "var(--color-slate)",
  },
  ".cm-tme-wikilink--source:hover": {
    backgroundColor: "color-mix(in srgb, var(--color-slate) 18%, var(--color-paper))",
    borderColor: "var(--color-slate)",
  },
  ".cm-tme-wikilink--concept": {
    backgroundColor: "color-mix(in srgb, var(--color-moss) 12%, var(--color-paper))",
    borderColor: "color-mix(in srgb, var(--color-moss) 35%, var(--color-rule-strong))",
    color: "var(--color-moss)",
  },
  ".cm-tme-wikilink--concept:hover": {
    backgroundColor: "color-mix(in srgb, var(--color-moss) 22%, var(--color-paper))",
    borderColor: "var(--color-moss)",
  },
  ".cm-tme-wikilink__icon": {
    fontSize: "0.85em",
    opacity: "0.7",
  },
  ".cm-tme-wikilink__label": {
    whiteSpace: "nowrap",
    maxWidth: "240px",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  ".cm-tme-wikilink-raw": {
    color: "var(--color-accent-ink)",
    backgroundColor: "color-mix(in srgb, var(--color-accent-wash) 70%, transparent)",
    borderRadius: "3px",
    padding: "0 2px",
  },
  ".cm-tme-wikilink-raw--source": {
    color: "var(--color-slate)",
    backgroundColor: "color-mix(in srgb, var(--color-slate) 8%, transparent)",
  },
  ".cm-tme-wikilink-raw--concept": {
    color: "var(--color-moss)",
    backgroundColor: "color-mix(in srgb, var(--color-moss) 10%, transparent)",
  },

  // --- Inline #tag chip ---
  ".cm-tme-tag": {
    display: "inline-block",
    padding: "0 7px",
    backgroundColor: "color-mix(in srgb, var(--color-accent) 12%, var(--color-paper))",
    color: "var(--color-accent-ink)",
    border: "1px solid color-mix(in srgb, var(--color-accent) 30%, var(--color-rule-soft))",
    borderRadius: "999px",
    fontSize: "0.86em",
    fontWeight: "500",
    letterSpacing: "0.01em",
    cursor: "pointer",
    lineHeight: "1.5",
    transition: "background-color 150ms ease, border-color 150ms ease",
    verticalAlign: "baseline",
    userSelect: "none",
  },
  ".cm-tme-tag:hover": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 22%, var(--color-paper))",
    borderColor: "var(--color-accent)",
  },
  ".cm-tme-tag:focus-visible": {
    outline: "2px solid var(--color-accent)",
    outlineOffset: "2px",
  },
  ".cm-tme-tag-raw": {
    color: "var(--color-accent-ink)",
    backgroundColor: "color-mix(in srgb, var(--color-accent) 8%, transparent)",
    borderRadius: "3px",
    padding: "0 2px",
    fontWeight: "500",
  },

  // --- Blockquote ---
  ".cm-tme-blockquote": {
    borderLeft: "3px solid var(--color-rule-strong)",
    paddingLeft: "12px",
    color: "var(--color-ink-2)",
    fontStyle: "italic",
  },

  // --- Task checkbox ---
  ".cm-tme-task": {
    display: "inline-flex",
    alignItems: "center",
    verticalAlign: "baseline",
    marginRight: "6px",
  },
  ".cm-tme-task--checked + *, .cm-tme-task--checked ~ *": {
    // Strike-through on completed task text is added via a separate
    // line-level class in 6.6+ when we know the full task line — for
    // 6.3 the box state alone is enough.
  },
  ".cm-tme-task__box": {
    cursor: "pointer",
    width: "15px",
    height: "15px",
    margin: "0",
    accentColor: "var(--color-accent)",
  },
});

/**
 * Build the complete live-preview extension stack. Plug this into the
 * editor's extension array after `markdownGfm()` and the base theme.
 */
export function livePreviewExtension(opts: LivePreviewOptions = {}): Extension {
  const exts: Extension[] = [
    sourceModeField,
    sourceModeKeymap,
    livePreviewPlugin,
    livePreviewTheme,
  ];
  if (opts.onSourceModeChange) {
    exts.push(sourceModeNotifier(opts.onSourceModeChange));
  }
  return exts;
}
