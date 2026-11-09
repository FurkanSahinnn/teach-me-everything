"use client";

/**
 * Notes route: an Obsidian-like three-pane workspace.
 *
 *   left   = file explorer (`NoteTree`) ⇄ `TagPanel`, resizable, collapsible
 *   center = `NoteHeader` + `NoteEditor` (live preview / source) or
 *            `NoteReadingView`; empty-state CTA when nothing is open
 *   right  = `OutlinePanel` over `BacklinksPanel`, resizable, collapsible
 *
 * Pane sizes, toolbar and palette choices persist in `prefs.noteEditor`.
 * `?id={noteId}` selects the note. Wikilink clicks resolve against notes,
 * sources and concepts; a missing note link creates the note (Obsidian's
 * click-to-create), other misses toast.
 */

import { notFound, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { FolderTree, NotebookPen, Tag as TagIcon } from "@/components/icons";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { BacklinksPanel } from "@/components/notes/BacklinksPanel";
import { EmbedAsSourceButton } from "@/components/notes/EmbedAsSourceButton";
import { EmbedAsSourceMenu } from "@/components/notes/EmbedAsSourceMenu";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { NoteReadingView } from "@/components/notes/NoteReadingView";
import { NoteTree } from "@/components/notes/NoteTree";
import { OutlinePanel } from "@/components/notes/OutlinePanel";
import { TagPanel } from "@/components/notes/TagPanel";
import { NoteHeader } from "@/components/notes/layout/NoteHeader";
import { PaneResizer } from "@/components/notes/layout/PaneResizer";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  useConceptsByWorkspace,
  useNote,
  useNotesByWorkspace,
  useSources,
  useWorkspace,
} from "@/lib/db/hooks";
import { createNote, updateNote } from "@/lib/db/notes";
import {
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
  type NoteViewMode,
  readFrontmatterEditorWidth,
} from "@/lib/notes/editor-prefs";
import { embedNoteAsSource } from "@/lib/notes/embed-as-source";
import { resolveEmbedderFromPrefs, type EmbedderResolutionFailure } from "@/lib/notes/embedder-factory";
import { estimateEmbedCost } from "@/lib/notes/source-sync";
import type { TagClickDetail, WikilinkClickDetail } from "@/lib/notes/live-preview";
import { buildWikilinkLookups, resolveWikilink } from "@/lib/notes/wikilink-resolver";
import { useRouteParams } from "@/lib/utils/route-params";
import { cn } from "@/lib/utils/cn";
import { usePrefs } from "@/stores/prefs";

type LeftTab = "tree" | "tags";

type EmbedResult = {
  kind: "success" | "error" | "missing-prereq";
  reason?: EmbedderResolutionFailure;
  chunkCount?: number;
  embedsRun?: number;
  costUsd?: number;
  message?: string;
};

const AUTO_SYNC_DELAY_MS = 5_000;
const DESKTOP_QUERY = "(min-width: 1024px)";

export default function NotesPage() {
  const params = useRouteParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = typeof params.id === "string" ? params.id : "";
  const noteIdParam = searchParams.get("id") ?? undefined;

  const t = useTranslations("notes.page");
  const pick = useLocalePick();
  const { toast } = useToast();

  const workspace = useWorkspace(workspaceId);
  const allNotes = useNotesByWorkspace(workspaceId);
  const sources = useSources(workspaceId);
  const concepts = useConceptsByWorkspace(workspaceId);
  const selectedNote = useNote(noteIdParam);

  const editorPrefs = usePrefs((s) => s.noteEditor);
  const setEditorPrefs = usePrefs((s) => s.setNoteEditorPrefs);
  const pushRecentColor = usePrefs((s) => s.pushNoteEditorRecentColor);
  const autoEmbedCap = usePrefs((s) => s.costPrefs.autoEmbedCap);

  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("tree");
  const [viewMode, setViewMode] = useState<NoteViewMode>(editorPrefs.defaultViewMode);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  // Live widths while a resize handle is dragged; prefs get the final value.
  const [dragLeft, setDragLeft] = useState<number | null>(null);
  const [dragRight, setDragRight] = useState<number | null>(null);

  // The outline reads the live view on click without re-rendering per edit.
  const editorViewRef = useRef<EditorView | null>(null);
  const autoSyncNoteIdRef = useRef<string | null>(null);

  const wikilinkLookups = useMemo(
    () =>
      buildWikilinkLookups({
        notes: (allNotes ?? []).map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt })),
        sources: (sources ?? []).map((s) => ({ id: s.id, title: s.title })),
        concepts: (concepts ?? []).map((c) => ({ id: c.id, name: c.label, updatedAt: c.updatedAt })),
      }),
    [allNotes, sources, concepts],
  );

  // Drop a stale `?id=` when the note was deleted (useNote → null, not loading).
  useEffect(() => {
    if (noteIdParam && selectedNote === null) {
      router.replace(`/w/${workspaceId}/notes`, { scroll: false });
    }
  }, [noteIdParam, selectedNote, router, workspaceId]);

  const handleSelectNote = useCallback(
    (id: string) => {
      setMobileTreeOpen(false);
      router.replace(`/w/${workspaceId}/notes?id=${id}`, { scroll: false });
    },
    [router, workspaceId],
  );

  const handleNoteCreated = useCallback(
    (id: string) => {
      setJustCreatedId(id);
      setViewMode((m) => (m === "reading" ? "live" : m));
      handleSelectNote(id);
    },
    [handleSelectNote],
  );

  const handleEditorChange = useCallback(
    async (doc: string) => {
      if (!noteIdParam) return;
      await updateNote(noteIdParam, { content: doc });
    },
    [noteIdParam],
  );

  const handleWikilinkClick = useCallback(
    (detail: WikilinkClickDetail) => {
      const resolution = resolveWikilink(
        { target: detail.target, kind: detail.kind, alias: detail.alias ?? undefined },
        wikilinkLookups,
      );
      if (resolution.exists && resolution.id) {
        if (resolution.kind === "note") return handleSelectNote(resolution.id);
        if (resolution.kind === "source") return router.push(`/w/${workspaceId}/read/${resolution.id}`);
        if (resolution.kind === "concept") return router.push(`/w/${workspaceId}/map?focus=${resolution.id}`);
      }
      if (resolution.kind === "note") {
        void (async () => {
          try {
            const created = await createNote({ workspaceId, content: `# ${resolution.target}\n\n` });
            toast({ title: t("missing_link_toast", { title: resolution.target }), variant: "info" });
            handleNoteCreated(created.id);
          } catch {
            toast({ title: t("navigate_failed_toast"), variant: "error" });
          }
        })();
        return;
      }
      toast({
        title: t("missing_link_kind_toast", { kind: resolution.kind, target: resolution.target }),
        variant: "warn",
      });
    },
    [wikilinkLookups, workspaceId, router, handleSelectNote, handleNoteCreated, t, toast],
  );

  const handleTagClick = useCallback((detail: TagClickDetail) => {
    setActiveTagFilter(detail.tag);
    setLeftTab("tree");
  }, []);

  const handleEditorReady = useCallback((view: EditorView | null) => {
    editorViewRef.current = view;
    // Test affordance: Playwright drives CM6 through this handle to avoid the
    // contentEditable typing races. No product code reads it.
    (window as Window & { __tmeEditorView?: EditorView | null }).__tmeEditorView = view;
  }, []);

  const getEditorView = useCallback(() => editorViewRef.current, []);

  const handleCreateFromEmpty = useCallback(async () => {
    try {
      const created = await createNote({ workspaceId });
      handleNoteCreated(created.id);
    } catch {
      toast({ title: t("navigate_failed_toast"), variant: "error" });
    }
  }, [workspaceId, handleNoteCreated, t, toast]);

  const handleEmbedResult = useCallback(
    (result: EmbedResult) => {
      if (result.kind === "success") {
        // `embedsRun: 0` = unchanged note, nothing billed; say so quietly.
        if ((result.embedsRun ?? 0) === 0) {
          toast({ title: t("embed_toast_success_reused"), variant: "info" });
          return;
        }
        toast({
          title: t("embed_toast_success", {
            chunks: String(result.chunkCount ?? 0),
            cost: (result.costUsd ?? 0).toFixed(4),
          }),
          variant: "success",
        });
        return;
      }
      if (result.kind === "missing-prereq") {
        const titleKey =
          result.reason === "vault-locked"
            ? "embed_toast_vault_locked"
            : result.reason === "no-key"
              ? "embed_toast_no_key"
              : "embed_toast_missing_prereq";
        toast({ title: t(titleKey), variant: "warn" });
        return;
      }
      toast({ title: t("embed_toast_error", { message: result.message ?? "" }), variant: "error" });
    },
    [toast, t],
  );

  const resolveEmbedderForButton = useCallback(async () => resolveEmbedderFromPrefs(), []);

  // Per-note auto-sync: re-embed 5 s after the last save when the note opted
  // in and the estimated cost stays under the cap. Every save resets the timer.
  useEffect(() => {
    if (!selectedNote?.autoEmbedOnSave) return;
    autoSyncNoteIdRef.current = selectedNote.id;
    const noteIdAtSchedule = selectedNote.id;
    const contentAtSchedule = selectedNote.content;
    const timer = setTimeout(() => {
      void (async () => {
        if (autoSyncNoteIdRef.current !== noteIdAtSchedule) return;
        const resolution = await resolveEmbedderFromPrefs();
        // Missing key: silent on the opt-in auto path; the button shows it.
        if (!resolution.handle) return;
        const cost = estimateEmbedCost(contentAtSchedule, resolution.handle.pricePerMillionTokensUsd ?? 0);
        if (autoEmbedCap > 0 && cost > autoEmbedCap) {
          toast({ title: t("embed_toast_cost_cap_reached", { cap: autoEmbedCap.toFixed(2) }), variant: "warn" });
          return;
        }
        try {
          const result = await embedNoteAsSource(noteIdAtSchedule, resolution.handle);
          if ((result.embedsRun ?? 0) > 0) {
            toast({ title: t("embed_toast_auto_synced", { chunks: String(result.chunkCount) }), variant: "info" });
          }
        } catch {
          // Quiet on the auto path; the button keeps its dirty state for a manual retry.
        }
      })();
    }, AUTO_SYNC_DELAY_MS);
    return () => clearTimeout(timer);
  }, [selectedNote?.id, selectedNote?.content, selectedNote?.autoEmbedOnSave, autoEmbedCap, t, toast]);

  // Ctrl/⌘+E leaves reading view (inside the editor CM handles it).
  useEffect(() => {
    if (viewMode !== "reading") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setViewMode("live");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewMode]);

  const toggleLeft = useCallback(() => {
    if (window.matchMedia(DESKTOP_QUERY).matches) {
      setEditorPrefs({ leftPanelOpen: !editorPrefs.leftPanelOpen });
    } else {
      setMobileTreeOpen((o) => !o);
    }
  }, [editorPrefs.leftPanelOpen, setEditorPrefs]);

  const toggleFocus = useCallback(() => {
    const focused = !editorPrefs.leftPanelOpen && !editorPrefs.rightPanelOpen;
    setEditorPrefs({ leftPanelOpen: focused, rightPanelOpen: focused });
  }, [editorPrefs.leftPanelOpen, editorPrefs.rightPanelOpen, setEditorPrefs]);

  if (!workspaceId || workspace === null) notFound();

  const breadcrumb = workspace
    ? [pick(workspace.name, workspace.nameEn ?? workspace.name), t("breadcrumb")]
    : [pick("Yükleniyor…", "Loading…"), t("breadcrumb")];

  const leftWidth = dragLeft ?? editorPrefs.leftPanelWidth;
  const rightWidth = dragRight ?? editorPrefs.rightPanelWidth;
  const hasNote = !!selectedNote;
  const folders = selectedNote ? selectedNote.path.split("/").slice(0, -1) : [];

  return (
    <AppShell workspaceId={workspaceId} title={t("title")} breadcrumb={breadcrumb}>
      <div
        className="relative flex h-full min-h-0 overflow-hidden"
        data-testid="notes-page"
        data-left-collapsed={editorPrefs.leftPanelOpen ? "false" : "true"}
      >
        {/* LEFT — explorer. Desktop: docked pane. Mobile: full width when no
            note is open, otherwise a drawer behind the header toggle. */}
        <aside
          style={{ "--notes-left-w": `${leftWidth}px` } as CSSProperties}
          className={cn(
            "relative min-h-0 shrink-0 flex-col border-r border-rule bg-paper-2",
            hasNote
              ? mobileTreeOpen
                ? "absolute inset-y-0 left-0 z-40 flex w-[min(88vw,320px)] shadow-[var(--shadow-deep)]"
                : "hidden"
              : "flex w-full",
            "lg:static lg:z-auto lg:w-[var(--notes-left-w)] lg:shadow-none",
            editorPrefs.leftPanelOpen ? "lg:flex" : "lg:hidden",
          )}
          data-testid="notes-left-pane"
        >
          <div className="flex h-11 shrink-0 items-center gap-1 border-b border-rule px-2">
            <div role="tablist" aria-label={t("title")} className="flex items-center gap-0.5">
              <TabButton
                active={leftTab === "tree"}
                onClick={() => setLeftTab("tree")}
                icon={<FolderTree className="h-3.5 w-3.5" aria-hidden />}
                label={t("tab_tree")}
                ariaLabel={t("tab_tree_aria")}
                testid="notes-left-tab-tree"
              />
              <TabButton
                active={leftTab === "tags"}
                onClick={() => setLeftTab("tags")}
                icon={<TagIcon className="h-3.5 w-3.5" aria-hidden />}
                label={t("tab_tags")}
                ariaLabel={t("tab_tags_aria")}
                testid="notes-left-tab-tags"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {leftTab === "tree" ? (
              <NoteTree
                workspaceId={workspaceId}
                selectedNoteId={noteIdParam}
                onSelectNote={handleSelectNote}
                onNoteCreated={handleNoteCreated}
                activeTagFilter={activeTagFilter}
                onClearTagFilter={() => setActiveTagFilter(null)}
              />
            ) : (
              <TagPanel
                workspaceId={workspaceId}
                activeTag={activeTagFilter}
                onTagSelect={(tag) => {
                  setActiveTagFilter(tag);
                  setLeftTab("tree");
                }}
                onClearFilter={() => setActiveTagFilter(null)}
              />
            )}
          </div>
          <PaneResizer
            side="right"
            width={leftWidth}
            min={PANEL_WIDTH_MIN}
            max={PANEL_WIDTH_MAX}
            label={t("resize_left_panel")}
            onResize={setDragLeft}
            onCommit={(w) => {
              setEditorPrefs({ leftPanelWidth: w });
              setDragLeft(null);
            }}
          />
        </aside>
        {hasNote && mobileTreeOpen ? (
          <button
            type="button"
            aria-label={t("collapse_left_panel")}
            onClick={() => setMobileTreeOpen(false)}
            className="absolute inset-0 z-30 bg-ink/20 lg:hidden"
          />
        ) : null}

        {/* CENTER */}
        <main className={cn("min-w-0 flex-1 flex-col bg-paper", hasNote ? "flex" : "hidden lg:flex")}>
          {selectedNote ? (
            <NoteHeader
              folders={folders}
              title={selectedNote.title}
              mode={viewMode}
              onModeChange={setViewMode}
              leftOpen={editorPrefs.leftPanelOpen}
              rightOpen={editorPrefs.rightPanelOpen}
              onToggleLeft={toggleLeft}
              onToggleRight={() => setEditorPrefs({ rightPanelOpen: !editorPrefs.rightPanelOpen })}
              onToggleFocus={toggleFocus}
              actions={
                <>
                  <EmbedAsSourceButton
                    noteId={selectedNote.id}
                    content={selectedNote.content}
                    resolveEmbedder={resolveEmbedderForButton}
                    onResult={handleEmbedResult}
                  />
                  <EmbedAsSourceMenu noteId={selectedNote.id} autoEmbedOnSave={selectedNote.autoEmbedOnSave ?? false} />
                </>
              }
            />
          ) : null}
          <CenterPane
            noteIdParam={noteIdParam}
            selectedNote={selectedNote}
            allNotesLoaded={allNotes !== undefined}
            hasAnyNote={(allNotes?.length ?? 0) > 0}
            onCreate={handleCreateFromEmpty}
            empty={{
              firstTitle: t("empty_title"),
              firstDescription: t("empty_description"),
              firstCta: t("empty_cta"),
              pickTitle: t("empty_pick_title"),
              pickDescription: t("empty_pick_description"),
            }}
          >
            {selectedNote ? (
              viewMode === "reading" ? (
                <NoteReadingView
                  content={selectedNote.content}
                  width={readFrontmatterEditorWidth(selectedNote.content) ?? editorPrefs.editorWidth}
                  fontSize={editorPrefs.fontSize}
                  onWikilinkClick={handleWikilinkClick}
                />
              ) : (
                <NoteEditor
                  key={selectedNote.id}
                  initialContent={selectedNote.content}
                  onChange={handleEditorChange}
                  onWikilinkClick={handleWikilinkClick}
                  onTagClick={handleTagClick}
                  onEditorReady={handleEditorReady}
                  wikilinkLookups={wikilinkLookups}
                  mode={viewMode}
                  onToggleReading={() => setViewMode("reading")}
                  prefs={editorPrefs}
                  onPrefsChange={setEditorPrefs}
                  onColorUsed={pushRecentColor}
                  autoFocus={selectedNote.id === justCreatedId}
                />
              )
            ) : null}
          </CenterPane>
        </main>

        {/* RIGHT — outline + backlinks */}
        <aside
          style={{ width: rightWidth }}
          className={cn(
            "relative hidden min-h-0 shrink-0 flex-col border-l border-rule bg-paper-2",
            editorPrefs.rightPanelOpen && hasNote && "lg:flex",
          )}
          data-testid="notes-right-pane"
        >
          <PaneResizer
            side="left"
            width={rightWidth}
            min={PANEL_WIDTH_MIN}
            max={PANEL_WIDTH_MAX}
            label={t("resize_right_panel")}
            onResize={setDragRight}
            onCommit={(w) => {
              setEditorPrefs({ rightPanelWidth: w });
              setDragRight(null);
            }}
          />
          <OutlinePanel
            content={selectedNote?.content ?? ""}
            getView={getEditorView}
            className="min-h-0 flex-[3] border-b border-rule"
          />
          <BacklinksPanel
            workspaceId={workspaceId}
            currentNoteTitle={selectedNote?.title ?? ""}
            currentNoteId={selectedNote?.id}
            onSelect={handleSelectNote}
            className="min-h-0 flex-[2]"
          />
        </aside>
      </div>
    </AppShell>
  );
}

type CenterPaneProps = {
  noteIdParam: string | undefined;
  selectedNote: ReturnType<typeof useNote>;
  allNotesLoaded: boolean;
  hasAnyNote: boolean;
  onCreate: () => void | Promise<void>;
  empty: {
    firstTitle: string;
    firstDescription: string;
    firstCta: string;
    pickTitle: string;
    pickDescription: string;
  };
  children: ReactNode;
};

function CenterPane({
  noteIdParam,
  selectedNote,
  allNotesLoaded,
  hasAnyNote,
  onCreate,
  empty,
  children,
}: CenterPaneProps) {
  // While Dexie loads, a skeleton avoids flashing the first-note CTA in a
  // workspace that actually has notes.
  const loading = (noteIdParam && selectedNote === undefined) || (!noteIdParam && !allNotesLoaded);
  if (loading) {
    return (
      <div className="p-6">
        <Skeleton variant="rect" height={480} />
      </div>
    );
  }
  if (selectedNote) return <>{children}</>;
  return hasAnyNote ? (
    <EmptyEditorPane title={empty.pickTitle} description={empty.pickDescription} cta={null} onCreate={onCreate} />
  ) : (
    <EmptyEditorPane
      title={empty.firstTitle}
      description={empty.firstDescription}
      cta={empty.firstCta}
      onCreate={onCreate}
    />
  );
}

type TabButtonProps = {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  ariaLabel: string;
  testid: string;
};

function TabButton({ active, onClick, icon, label, ariaLabel, testid }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={ariaLabel}
      onClick={onClick}
      data-testid={testid}
      data-active={active ? "true" : "false"}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px] font-medium transition-colors",
        active ? "bg-paper-3 text-ink" : "text-ink-3 hover:bg-paper-3 hover:text-ink",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

type EmptyEditorPaneProps = {
  title: string;
  description: string;
  /** null hides the button (the "pick a note" hint state). */
  cta: string | null;
  onCreate: () => void | Promise<void>;
};

function EmptyEditorPane({ title, description, cta, onCreate }: EmptyEditorPaneProps) {
  return (
    <div
      data-testid="notes-empty-pane"
      data-variant={cta ? "first" : "pick"}
      className="grid flex-1 place-items-center px-6 py-12 text-center"
    >
      <div className="flex max-w-md flex-col items-center gap-3">
        <div aria-hidden className="grid h-12 w-12 place-items-center rounded-full bg-paper-3 text-ink-3">
          <NotebookPen className="h-5 w-5" />
        </div>
        <h2 className="font-serif text-[20px] text-ink">{title}</h2>
        <p className="text-[13px] leading-5 text-ink-3">{description}</p>
        {cta ? (
          <Button size="sm" variant="primary" onClick={() => void onCreate()} data-testid="notes-empty-create">
            {cta}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
