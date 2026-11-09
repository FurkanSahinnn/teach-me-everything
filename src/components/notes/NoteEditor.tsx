"use client";

/**
 * CodeMirror 6 markdown editor for notes: Obsidian-style live preview, the
 * Editing Toolbar (docked ribbon and/or floating selection bar), a status bar
 * with the Editor Width Slider, and autosave.
 *
 * Controlled-once API: pass `initialContent` and remount with `key={noteId}`
 * to switch documents. The editor never re-reads `initialContent` after mount:
 * autosave is the source of truth, and round-tripping props would clobber
 * in-flight edits.
 */

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redoDepth,
  undoDepth,
} from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, drawSelection, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { useTranslations } from "next-intl";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_AUTOSAVE_MS, autosaveExtension, countWords, editorBaseTheme } from "@/lib/notes/cm6-extensions";
import {
  DEFAULT_NOTE_EDITOR_PREFS,
  type NoteEditorPrefs,
  type NoteViewMode,
  readFrontmatterEditorWidth,
} from "@/lib/notes/editor-prefs";
import {
  applyBackgroundColor,
  applyTextColor,
  getActiveFormats,
  toggleHighlight,
  toggleSubscript,
  toggleSuperscript,
  toggleUnderline,
} from "@/lib/notes/format-commands";
import type { FormatState } from "@/lib/notes/format-edits";
import { listKeymap } from "@/lib/notes/list-keymap";
import {
  TME_EVENT,
  type TagClickDetail,
  type WikilinkClickDetail,
  livePreviewExtension,
  markdownGfm,
  setSourceMode,
} from "@/lib/notes/live-preview";
import { notesSyntaxHighlighting } from "@/lib/notes/live-preview/highlight-style";
import { refreshWikilinkStatus, wikilinkStatusFacet } from "@/lib/notes/live-preview/wikilink-widget";
import {
  insertLink,
  setHeading,
  toggleBold,
  toggleCheckbox,
  toggleInlineCode,
  toggleItalic,
  toggleStrike,
} from "@/lib/notes/toolbar-commands";
import { wikilinkAutocomplete } from "@/lib/notes/wikilink-autocomplete";
import { type WikilinkLookups, resolveWikilink } from "@/lib/notes/wikilink-resolver";
import { cn } from "@/lib/utils/cn";
import { EditorStatusBar, type SaveState } from "./editor/EditorStatusBar";
import { EditingToolbar } from "./toolbar/EditingToolbar";

export type NoteEditorProps = {
  /** Initial document. Use `key={noteId}` to remount on note switch. */
  initialContent?: string;
  /** Called after the debounce window with the latest doc string. */
  onChange?: (doc: string) => void | Promise<void>;
  onWikilinkClick?: (detail: WikilinkClickDetail) => void;
  onTagClick?: (detail: TagClickDetail) => void;
  /** Receives the live view after mount and `null` on teardown. */
  onEditorReady?: (view: EditorView | null) => void;
  /** Workspace entity index for `[[` autocomplete and unresolved-link styling. */
  wikilinkLookups?: WikilinkLookups | null;
  /** Live preview or raw markdown. Reading mode is rendered by the page. */
  mode?: Exclude<NoteViewMode, "reading">;
  /** `Mod-E` asks the page to switch to reading view (Obsidian's binding). */
  onToggleReading?: () => void;
  prefs: NoteEditorPrefs;
  onPrefsChange: (patch: Partial<NoteEditorPrefs>) => void;
  onColorUsed: (color: string) => void;
  /** Focus on mount and select the H1 text of a freshly created note. */
  autoFocus?: boolean;
  placeholder?: string;
  autosaveMs?: number;
  editable?: boolean;
  className?: string;
};

type FloatingPos = { top: number; left: number };

const FLOATING_ITEMS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "highlight",
  "textColor",
  "inlineCode",
  "link",
  "wikilink",
  "clearFormatting",
] as const;

const FRESH_TITLE_RE = /^# (.+)$/;
const FLOATING_OFFSET_Y = 46;
const FLOATING_MAX_WIDTH = 360;

export function NoteEditor({
  initialContent = "",
  onChange,
  onWikilinkClick,
  onTagClick,
  onEditorReady,
  wikilinkLookups,
  mode = "live",
  onToggleReading,
  prefs,
  onPrefsChange,
  onColorUsed,
  autoFocus = false,
  placeholder: placeholderProp,
  autosaveMs = DEFAULT_AUTOSAVE_MS,
  editable = true,
  className,
}: NoteEditorProps) {
  const tEditor = useTranslations("notes.editor");

  const hostRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [spellcheckCompartment] = useState(() => new Compartment());

  const [counts, setCounts] = useState(() => ({
    words: countWords(initialContent),
    characters: initialContent.length,
  }));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [formats, setFormats] = useState<FormatState | null>(null);
  const [historyDepth, setHistoryDepth] = useState({ undo: false, redo: false });
  const [floating, setFloating] = useState<FloatingPos | null>(null);
  const [noteWidth, setNoteWidth] = useState<number | null>(() => readFrontmatterEditorWidth(initialContent));
  const [painter, setPainter] = useState<FormatState | null>(null);
  const [lastColors, setLastColors] = useState(() => ({
    text: prefs.textColors[0] ?? DEFAULT_NOTE_EDITOR_PREFS.textColors[0] ?? "#e5484d",
    background: prefs.backgroundColors[0] ?? DEFAULT_NOTE_EDITOR_PREFS.backgroundColors[0] ?? "#ffe06659",
  }));

  // Callbacks and inputs read by long-lived CM extensions go through refs so
  // the editor is built once per mount.
  const onChangeRef = useRef(onChange);
  const onWikilinkClickRef = useRef(onWikilinkClick);
  const onTagClickRef = useRef(onTagClick);
  const onEditorReadyRef = useRef(onEditorReady);
  const onToggleReadingRef = useRef(onToggleReading);
  const wikilinkLookupsRef = useRef<WikilinkLookups | null>(wikilinkLookups ?? null);
  const painterRef = useRef<FormatState | null>(null);
  const toolbarModeRef = useRef(prefs.toolbarMode);
  useEffect(() => {
    onChangeRef.current = onChange;
    onWikilinkClickRef.current = onWikilinkClick;
    onTagClickRef.current = onTagClick;
    onEditorReadyRef.current = onEditorReady;
    onToggleReadingRef.current = onToggleReading;
    painterRef.current = painter;
    toolbarModeRef.current = prefs.toolbarMode;
  });

  // Batch per-update UI state into one React update per animation frame.
  const frameRef = useRef<number | null>(null);
  const docDirtyRef = useRef(false);
  const scheduleUiSync = useCallback((view: EditorView, docChanged: boolean) => {
    if (docChanged) docDirtyRef.current = true;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const { state } = view;
      if (docDirtyRef.current) {
        docDirtyRef.current = false;
        const doc = state.doc.toString();
        setCounts({ words: countWords(doc), characters: doc.length });
        setNoteWidth(readFrontmatterEditorWidth(doc));
      }
      setFormats(getActiveFormats(view));
      setHistoryDepth({ undo: undoDepth(state) > 0, redo: redoDepth(state) > 0 });
      setFloating(computeFloatingPos(view, shellRef.current, toolbarModeRef.current));
    });
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;
    const placeholderText = placeholderProp ?? tEditor("placeholder");
    const phrases = tEditor.raw("cm_phrases") as Record<string, string>;

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        EditorState.allowMultipleSelections.of(true),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        EditorState.phrases.of(phrases),
        spellcheckCompartment.of(
          EditorView.contentAttributes.of({ spellcheck: prefs.spellcheck ? "true" : "false" }),
        ),
        markdownGfm(),
        notesSyntaxHighlighting(),
        editorBaseTheme,
        livePreviewExtension(),
        wikilinkStatusFacet.of((target, kind) => {
          const lookups = wikilinkLookupsRef.current;
          if (!lookups) return true;
          return resolveWikilink({ target, kind }, lookups).exists;
        }),
        wikilinkAutocomplete({ getLookups: () => wikilinkLookupsRef.current }),
        cmPlaceholder(placeholderText),
        EditorView.editable.of(editable),
        EditorState.readOnly.of(!editable),
        listKeymap,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) setSaveState((prev) => (prev === "saving" ? prev : "dirty"));
          if (update.docChanged || update.selectionSet || update.focusChanged) {
            scheduleUiSync(update.view, update.docChanged);
          }
        }),
        EditorView.domEventHandlers({
          mouseup: (_event, view) => {
            const snapshot = painterRef.current;
            if (!snapshot) return false;
            // Let CodeMirror commit the drag selection before painting it.
            requestAnimationFrame(() => {
              if (view.state.selection.main.empty) return;
              applyFormatSnapshot(view, snapshot);
              setPainter(null);
            });
            return false;
          },
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
              // Stay dirty so the indicator re-arms and the next keystroke retries.
              setSaveState("dirty");
            }
          },
        }),
        Prec.high(
          keymap.of([
            { key: "Mod-e", preventDefault: true, run: () => (onToggleReadingRef.current?.(), true) },
            { key: "Mod-b", run: (v) => (toggleBold(v), true) },
            { key: "Mod-i", run: (v) => (toggleItalic(v), true) },
            { key: "Mod-u", preventDefault: true, run: (v) => toggleUnderline(v) || true },
            { key: "Mod-Shift-x", run: (v) => (toggleStrike(v), true) },
            { key: "Mod-Shift-h", preventDefault: true, run: (v) => toggleHighlight(v) || true },
            { key: "Mod-`", run: (v) => (toggleInlineCode(v), true) },
            { key: "Mod-.", run: (v) => toggleSuperscript(v) || true },
            { key: "Mod-,", run: (v) => toggleSubscript(v) || true },
            { key: "Mod-Enter", run: (v) => (toggleCheckbox(v), true) },
            {
              key: "Mod-k",
              preventDefault: true,
              run: (v) => {
                insertLink(v, {
                  placeholderUrl: tEditor("link_placeholder_url"),
                  placeholderLabel: tEditor("link_placeholder_label"),
                });
                return true;
              },
            },
            ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
              key: `Mod-Alt-${level}`,
              preventDefault: true,
              run: (v: EditorView) => (setHeading(v, level), true),
            })),
          ]),
        ),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      ],
    });

    const host = hostRef.current;
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    const handleWikilink = (event: Event) => {
      const ce = event as CustomEvent<WikilinkClickDetail>;
      if (ce.detail) onWikilinkClickRef.current?.(ce.detail);
    };
    const handleTag = (event: Event) => {
      const ce = event as CustomEvent<TagClickDetail>;
      if (ce.detail) onTagClickRef.current?.(ce.detail);
    };
    host.addEventListener(TME_EVENT.wikilinkClick, handleWikilink);
    host.addEventListener(TME_EVENT.tagClick, handleTag);

    onEditorReadyRef.current?.(view);

    if (autoFocus) {
      const first = view.state.doc.line(1);
      const match = FRESH_TITLE_RE.exec(first.text);
      view.focus();
      view.dispatch({
        selection: match ? { anchor: first.from + 2, head: first.to } : { anchor: view.state.doc.length },
        scrollIntoView: true,
      });
    }

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      host.removeEventListener(TME_EVENT.wikilinkClick, handleWikilink);
      host.removeEventListener(TME_EVENT.tagClick, handleTag);
      onEditorReadyRef.current?.(null);
      view.destroy();
      viewRef.current = null;
    };
    // Built once per mount; inputs that change later are read through refs or
    // pushed in by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view) setSourceMode(view, mode === "source");
  }, [mode]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: spellcheckCompartment.reconfigure(
        EditorView.contentAttributes.of({ spellcheck: prefs.spellcheck ? "true" : "false" }),
      ),
    });
  }, [prefs.spellcheck, spellcheckCompartment]);

  // New notes / sources / concepts change which links resolve.
  useEffect(() => {
    wikilinkLookupsRef.current = wikilinkLookups ?? null;
    viewRef.current?.dispatch({ effects: refreshWikilinkStatus.of(null) });
  }, [wikilinkLookups]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const id = setTimeout(() => setSaveState((prev) => (prev === "saved" ? "idle" : prev)), 1800);
    return () => clearTimeout(id);
  }, [saveState]);

  const getView = useCallback(() => viewRef.current, []);

  const handleColorUsed = useCallback(
    (kind: "text" | "background", color: string) => {
      setLastColors((prev) => (kind === "text" ? { ...prev, text: color } : { ...prev, background: color }));
      onColorUsed(color);
    },
    [onColorUsed],
  );

  const togglePainter = useCallback(() => {
    const view = viewRef.current;
    setPainter((current) => (current || !view ? null : getActiveFormats(view)));
  }, []);

  const showTopToolbar = prefs.toolbarMode === "top" || prefs.toolbarMode === "both";
  const toolbarShared = {
    getView,
    formats,
    canUndo: historyDepth.undo,
    canRedo: historyDepth.redo,
    painterActive: painter !== null,
    onTogglePainter: togglePainter,
    textColors: prefs.textColors,
    backgroundColors: prefs.backgroundColors,
    recentColors: prefs.recentColors,
    lastTextColor: lastColors.text,
    lastBackgroundColor: lastColors.background,
    onColorUsed: handleColorUsed,
  };

  const editorStyle = {
    "--tme-editor-width": `${noteWidth ?? prefs.editorWidth}px`,
    "--tme-editor-font-size": `${prefs.fontSize}px`,
  } as CSSProperties;

  return (
    <div
      ref={shellRef}
      className={cn("tme-note-editor relative flex h-full min-h-0 flex-col", className)}
      data-testid="note-editor"
      data-painter={painter ? "true" : "false"}
    >
      {showTopToolbar ? (
        <div className="shrink-0 border-b border-rule px-3 py-1.5">
          <EditingToolbar {...toolbarShared} items={prefs.toolbarItems} />
        </div>
      ) : null}
      <div
        ref={hostRef}
        style={editorStyle}
        className={cn("min-h-0 flex-1 overflow-auto", painter && "cursor-copy")}
        data-testid="note-editor-host"
      />
      {floating ? (
        <div
          className="absolute z-30 rounded-[10px] border border-rule bg-paper p-1 shadow-[var(--shadow-deep)]"
          style={{ top: floating.top, left: floating.left }}
          data-testid="floating-toolbar"
        >
          <EditingToolbar {...toolbarShared} items={FLOATING_ITEMS} variant="compact" />
        </div>
      ) : null}
      <EditorStatusBar
        words={counts.words}
        characters={counts.characters}
        saveState={saveState}
        width={prefs.editorWidth}
        noteWidth={noteWidth}
        onWidthChange={(px) => onPrefsChange({ editorWidth: px })}
        onWidthReset={() => onPrefsChange({ editorWidth: DEFAULT_NOTE_EDITOR_PREFS.editorWidth })}
      />
    </div>
  );
}

/** Where the floating selection toolbar sits, or null when it should hide. */
function computeFloatingPos(
  view: EditorView,
  shell: HTMLElement | null,
  toolbarMode: NoteEditorPrefs["toolbarMode"],
): FloatingPos | null {
  if (toolbarMode !== "floating" && toolbarMode !== "both") return null;
  const sel = view.state.selection.main;
  if (!shell || !view.hasFocus || sel.empty) return null;
  const start = view.coordsAtPos(sel.from);
  if (!start) return null;
  const shellRect = shell.getBoundingClientRect();
  return {
    top: Math.max(4, start.top - shellRect.top - FLOATING_OFFSET_Y),
    left: Math.min(
      Math.max(8, start.left - shellRect.left - 24),
      Math.max(8, shellRect.width - FLOATING_MAX_WIDTH),
    ),
  };
}

/** Format painter: re-apply the captured formats to the new selection. */
function applyFormatSnapshot(view: EditorView, snapshot: FormatState): void {
  const current = getActiveFormats(view);
  if (snapshot.bold && !current.bold) toggleBold(view);
  if (snapshot.italic && !current.italic) toggleItalic(view);
  if (snapshot.strike && !current.strike) toggleStrike(view);
  if (snapshot.underline && !current.underline) toggleUnderline(view);
  if (snapshot.highlight && !current.highlight) toggleHighlight(view);
  if (snapshot.code && !current.code) toggleInlineCode(view);
  if (snapshot.color && snapshot.color !== current.color) applyTextColor(view, snapshot.color);
  if (snapshot.background && snapshot.background !== current.background) {
    applyBackgroundColor(view, snapshot.background);
  }
}
