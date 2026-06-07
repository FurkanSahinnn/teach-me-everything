"use client";

/**
 * Phase 6.2 + 6.3 + 6.5 — CodeMirror 6 markdown editor with live preview
 * and wikilink autocomplete.
 *
 * Renders a single-pane CM6 markdown editor with:
 *   - GFM syntax (Tables, TaskList, Strikethrough, Autolink) via `markdownGfm`
 *   - Live-preview decorations: heading scale, inline mark hide, wikilink
 *     chips, blockquote rail, clickable task checkboxes. Active line (the
 *     one with the cursor) reverts to raw markdown so editing stays direct.
 *   - `Ctrl+E` toggles full source mode — drops all decorations until pressed
 *     again. Footer pill announces the mode.
 *   - Debounced autosave (~800 ms) flushed on unmount.
 *   - Save-state pill (idle / dirty / saving / saved) + live word count.
 *   - Toolbar with H2/H3, bold/italic/strike/code, list/ordered/checkbox/quote,
 *     link, wikilink. Keyboard shortcuts: ⌘B / ⌘I / ⌘` for inline marks,
 *     ⌘E to toggle source mode.
 *   - Wikilink chip click → fires `onWikilinkClick(detail)` so the parent
 *     route can navigate or open a "create" prompt.
 *   - `[[` triggers a wikilink autocomplete dropdown sourced from
 *     `wikilinkLookups` (Phase 6.5). The lookups are read via ref on every
 *     completion so live workspace changes propagate without remounting CM6.
 *
 * Controlled-once API: pass `initialContent` and use a route-stable `key`
 * (e.g. `key={noteId}`) to remount the editor when switching notes. The
 * editor doesn't sync `initialContent` after mount — autosave is the source
 * of truth and round-tripping props would clobber in-flight edits.
 */

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  keymap,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  DEFAULT_AUTOSAVE_MS,
  autosaveExtension,
  editorBaseTheme,
  wordCountExtension,
} from "@/lib/notes/cm6-extensions";
import {
  TME_EVENT,
  type TagClickDetail,
  type WikilinkClickDetail,
  livePreviewExtension,
  markdownGfm,
} from "@/lib/notes/live-preview";
import {
  toggleBold,
  toggleInlineCode,
  toggleItalic,
} from "@/lib/notes/toolbar-commands";
import { wikilinkAutocomplete } from "@/lib/notes/wikilink-autocomplete";
import type { WikilinkLookups } from "@/lib/notes/wikilink-resolver";
import { cn } from "@/lib/utils/cn";
import { EditorToolbar } from "./EditorToolbar";

type SaveState = "idle" | "dirty" | "saving" | "saved";

export type NoteEditorProps = {
  /** Initial document. Use `key={noteId}` to remount on note switch. */
  initialContent?: string;
  /** Called after the debounce window with the latest doc string. */
  onChange?: (doc: string) => void | Promise<void>;
  /** Called on every doc change with the running word count. */
  onWordCountChange?: (count: number) => void;
  /**
   * Fired when the user clicks (or activates via keyboard) a wikilink chip.
   * The parent decides whether to navigate to the resolved entity or open
   * a "create new" prompt for missing notes.
   */
  onWikilinkClick?: (detail: WikilinkClickDetail) => void;
  /**
   * Fired when the user clicks (or activates via keyboard) a `#tag` chip
   * (Phase 6.6). The parent typically routes this into the workspace tag
   * filter so the sidebar `NoteTree` narrows down to matching notes.
   */
  onTagClick?: (detail: TagClickDetail) => void;
  /**
   * Fired once with the live `EditorView` after CM6 mounts, and again with
   * `null` on teardown. Used by external panels (e.g. the outline) that need
   * to dispatch transactions like `selection: cursor(line); scrollIntoView`
   * without owning the editor lifecycle. The callback is stored via ref so
   * a re-renders-with-new-handler doesn't tear the extension down.
   */
  onEditorReady?: (view: EditorView | null) => void;
  /**
   * Workspace entity index that drives the `[[` autocomplete dropdown. Pass
   * the latest snapshot from `useLiveQuery` — the editor reads it through
   * a ref so updates are immediate without re-mounting CM6. Pass `null`
   * (or omit) to disable autocomplete entirely.
   */
  wikilinkLookups?: WikilinkLookups | null;
  /** Override the localized placeholder. */
  placeholder?: string;
  /** Debounce delay before `onChange` fires. */
  autosaveMs?: number;
  /** Hide the toolbar (e.g. for embedded preview). */
  showToolbar?: boolean;
  /**
   * Right-aligned actions threaded into the toolbar slot. Phase 6.9.4 wires
   * the "Embed as source" button here; kept generic so other consumers can
   * attach mode switches or export buttons without forking the editor.
   */
  toolbarTrailingActions?: ReactNode;
  /** Hide the word-count + save-state footer. */
  showFooter?: boolean;
  /** When false, the editor renders read-only. */
  editable?: boolean;
  className?: string;
};

export function NoteEditor({
  initialContent = "",
  onChange,
  onWordCountChange,
  onWikilinkClick,
  onTagClick,
  onEditorReady,
  wikilinkLookups,
  placeholder: placeholderProp,
  autosaveMs = DEFAULT_AUTOSAVE_MS,
  showToolbar = true,
  toolbarTrailingActions,
  showFooter = true,
  editable = true,
  className,
}: NoteEditorProps) {
  const tEditor = useTranslations("notes.editor");
  const tFooter = useTranslations("notes.editor.footer");

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const [wordCount, setWordCount] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [sourceMode, setSourceMode] = useState(false);

  // Stabilize callbacks so the CM6 setup effect runs exactly once per mount —
  // the `onCloseRef`-style pattern from Phase 5.5.G prevents extension teardown
  // when the parent re-renders with a new inline handler.
  const onChangeRef = useRef(onChange);
  const onWordCountRef = useRef(onWordCountChange);
  const onWikilinkClickRef = useRef(onWikilinkClick);
  const onTagClickRef = useRef(onTagClick);
  const onEditorReadyRef = useRef(onEditorReady);
  // Lookups updated via ref so the autocomplete source always sees the
  // latest workspace snapshot without re-creating the extension.
  const wikilinkLookupsRef = useRef<WikilinkLookups | null>(wikilinkLookups ?? null);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onWordCountRef.current = onWordCountChange;
  }, [onWordCountChange]);
  useEffect(() => {
    onWikilinkClickRef.current = onWikilinkClick;
  }, [onWikilinkClick]);
  useEffect(() => {
    onTagClickRef.current = onTagClick;
  }, [onTagClick]);
  useEffect(() => {
    onEditorReadyRef.current = onEditorReady;
  }, [onEditorReady]);
  useEffect(() => {
    wikilinkLookupsRef.current = wikilinkLookups ?? null;
  }, [wikilinkLookups]);

  // Mount CM6 once per editor lifecycle. `key={noteId}` from the parent is
  // the seam for swapping documents — that triggers an unmount/remount and a
  // fresh `EditorState.create` with the new initial doc.
  useEffect(() => {
    if (!hostRef.current) return;

    const placeholderText = placeholderProp ?? tEditor("placeholder");

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        EditorState.allowMultipleSelections.of(true),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        markdownGfm(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        editorBaseTheme,
        livePreviewExtension({ onSourceModeChange: setSourceMode }),
        wikilinkAutocomplete({
          getLookups: () => wikilinkLookupsRef.current,
        }),
        cmPlaceholder(placeholderText),
        EditorView.editable.of(editable),
        EditorState.readOnly.of(!editable),
        // Mark the editor "dirty" on every keystroke; the autosave plugin
        // flips it to "saving" → "saved" once the debounce window expires.
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          setSaveState((prev) => (prev === "saving" ? prev : "dirty"));
        }),
        autosaveExtension({
          delayMs: autosaveMs,
          onSave: async (doc) => {
            const cb = onChangeRef.current;
            setSaveState("saving");
            try {
              if (cb) await Promise.resolve(cb(doc));
              setSaveState("saved");
            } catch {
              // If the parent threw, stay in `dirty` so the indicator
              // re-arms on the next keystroke and the user knows the save
              // didn't land. Throwing here would crash the CM plugin.
              setSaveState("dirty");
            }
          },
        }),
        wordCountExtension({
          onUpdate: (n) => {
            setWordCount(n);
            onWordCountRef.current?.(n);
          },
        }),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
          {
            key: "Mod-b",
            run: (view) => {
              toggleBold(view);
              return true;
            },
          },
          {
            key: "Mod-i",
            run: (view) => {
              toggleItalic(view);
              return true;
            },
          },
          {
            key: "Mod-`",
            run: (view) => {
              toggleInlineCode(view);
              return true;
            },
          },
        ]),
      ],
    });

    const host = hostRef.current;
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    const handleWikilink = (event: Event) => {
      const ce = event as CustomEvent<WikilinkClickDetail>;
      if (!ce.detail) return;
      onWikilinkClickRef.current?.(ce.detail);
    };
    const handleTag = (event: Event) => {
      const ce = event as CustomEvent<TagClickDetail>;
      if (!ce.detail) return;
      onTagClickRef.current?.(ce.detail);
    };
    host.addEventListener(TME_EVENT.wikilinkClick, handleWikilink);
    host.addEventListener(TME_EVENT.tagClick, handleTag);

    onEditorReadyRef.current?.(view);

    return () => {
      host.removeEventListener(TME_EVENT.wikilinkClick, handleWikilink);
      host.removeEventListener(TME_EVENT.tagClick, handleTag);
      onEditorReadyRef.current?.(null);
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally empty deps — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-clear the "saved" badge after a short window so it acts as a
  // transient confirmation rather than a permanent label.
  useEffect(() => {
    if (saveState !== "saved") return;
    const id = setTimeout(() => {
      setSaveState((prev) => (prev === "saved" ? "idle" : prev));
    }, 1800);
    return () => clearTimeout(id);
  }, [saveState]);

  // Provide a stable view accessor for the toolbar — passing a closure that
  // reads from a ref avoids re-rendering the toolbar on every CM6 update.
  const getView = () => viewRef.current;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col rounded-[12px] border border-rule bg-paper",
        className,
      )}
      data-testid="note-editor"
    >
      {showToolbar ? (
        <EditorToolbar
          getView={getView}
          trailingActions={toolbarTrailingActions}
        />
      ) : null}
      <div
        ref={hostRef}
        className="flex-1 min-h-0 overflow-auto"
        data-testid="note-editor-host"
      />
      {showFooter ? (
        <NoteEditorFooter
          wordCount={wordCount}
          saveState={saveState}
          sourceMode={sourceMode}
          labels={{
            zero: tFooter("word_count_zero"),
            one: tFooter("word_count_one"),
            many: (count: number) => tFooter("word_count_many", { count }),
            saving: tFooter("saving"),
            saved: tFooter("saved"),
            sourceMode: tFooter("source_mode"),
          }}
        />
      ) : null}
    </div>
  );
}

type FooterLabels = {
  zero: string;
  one: string;
  many: (count: number) => string;
  saving: string;
  saved: string;
  sourceMode: string;
};

function NoteEditorFooter({
  wordCount,
  saveState,
  sourceMode,
  labels,
}: {
  wordCount: number;
  saveState: SaveState;
  sourceMode: boolean;
  labels: FooterLabels;
}) {
  let label: string;
  if (wordCount === 0) label = labels.zero;
  else if (wordCount === 1) label = labels.one;
  else label = labels.many(wordCount);

  return (
    <div className="flex items-center justify-between gap-3 border-t border-rule px-3 py-1.5 text-[12px] text-ink-4">
      <span data-testid="note-editor-word-count" className="tabular-nums">
        {label}
      </span>
      <div className="flex items-center gap-3">
        {sourceMode ? (
          <span
            data-testid="note-editor-source-mode"
            data-active="true"
            className="inline-flex items-center gap-1.5 rounded-full border border-rule-strong/60 bg-paper-3 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-3"
          >
            <span aria-hidden className="font-mono text-[10px]">{"<>"}</span>
            {labels.sourceMode}
          </span>
        ) : null}
        <SaveStateBadge state={saveState} savingLabel={labels.saving} savedLabel={labels.saved} />
      </div>
    </div>
  );
}

function SaveStateBadge({
  state,
  savingLabel,
  savedLabel,
}: {
  state: SaveState;
  savingLabel: string;
  savedLabel: string;
}) {
  if (state === "idle") return null;

  if (state === "saved") {
    return (
      <span
        data-testid="note-editor-save-state"
        data-state={state}
        className="inline-flex items-center gap-1.5 text-moss"
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-moss" />
        {savedLabel}
      </span>
    );
  }

  return (
    <span
      data-testid="note-editor-save-state"
      data-state={state}
      className="inline-flex items-center gap-1.5 text-accent"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
      {savingLabel}
    </span>
  );
}
