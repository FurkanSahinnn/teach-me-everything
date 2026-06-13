"use client";

/**
 * Phase 6.8 — Notes route.
 *
 * Three-pane workspace surface for the user's markdown vault:
 *
 *   left   = `NoteTree` ⇄ `TagPanel` (tabs)
 *   center = `NoteEditor` (CodeMirror 6 live preview) or empty-state CTA
 *   right  = `BacklinksPanel` (above) + `OutlinePanel` (below)
 *
 * State is split across the URL and a few local atoms:
 *   - `?id={noteId}` query param drives the selected note. `router.replace`
 *     keeps history sane while the editor switches notes.
 *   - `activeTagFilter` is local — both `TagPanel` (sets) and `NoteTree`
 *     (consumes + clears) share it; clicking a `#tag` chip inside the
 *     editor also routes here.
 *   - `editorViewRef` exposes the live `EditorView` so the outline can
 *     dispatch a scrolling cursor transaction without owning the editor.
 *
 * Wikilink clicks are resolved against the workspace's notes/sources/
 * concepts. A note miss auto-creates a fresh note with the link target as
 * its H1 title — Obsidian's "click-to-create" behavior. Source/concept
 * misses surface a toast instead.
 */

import {
  ChevronsLeft,
  ChevronsRight,
  FolderTree,
  NotebookPen,
  Tag as TagIcon,
} from "lucide-react";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { useRouteParams } from "@/lib/utils/route-params";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EditorView } from "@codemirror/view";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { BacklinksPanel } from "@/components/notes/BacklinksPanel";
import { EmbedAsSourceButton } from "@/components/notes/EmbedAsSourceButton";
import { EmbedAsSourceMenu } from "@/components/notes/EmbedAsSourceMenu";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { NoteTree } from "@/components/notes/NoteTree";
import { OutlinePanel } from "@/components/notes/OutlinePanel";
import { TagPanel } from "@/components/notes/TagPanel";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  useConceptsByWorkspace,
  useNote,
  useNotesByWorkspace,
  useSources,
  useWorkspace,
} from "@/lib/db/hooks";
import { createNote, updateNote } from "@/lib/db/notes";
import { embedNoteAsSource } from "@/lib/notes/embed-as-source";
import {
  resolveEmbedderFromPrefs,
  type EmbedderResolutionFailure,
} from "@/lib/notes/embedder-factory";
import { estimateEmbedCost } from "@/lib/notes/source-sync";
import type {
  TagClickDetail,
  WikilinkClickDetail,
} from "@/lib/notes/live-preview";
import {
  buildWikilinkLookups,
  resolveWikilink,
} from "@/lib/notes/wikilink-resolver";
import { usePrefs } from "@/stores/prefs";
import { cn } from "@/lib/utils/cn";

type LeftTab = "tree" | "tags";

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

  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("tree");
  // Collapse the left tree/tags pane on demand so the editor gets the full
  // horizontal real estate. Local state — no prefs persistence; users who
  // want the panel back hit the small expand chevron on the left rail.
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  // Editor view lives in a ref so the outline can read it on-click without
  // forcing a re-render every time CM6's internal state changes.
  const editorViewRef = useRef<EditorView | null>(null);

  // Phase 6.9.5 — Auto-sync timer. Tracks the active debounce so the cleanup
  // path (note switch, unmount, manual sync) can cancel a pending re-embed
  // before it fires. Ref instead of state because we never need to re-render
  // on timer changes, and the value lives outside React's reconciliation.
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the most recently scheduled note id so a stale timer (note A
  // switched to note B before the 5s fired) doesn't write into B's source.
  const autoSyncNoteIdRef = useRef<string | null>(null);
  const autoEmbedCap = usePrefs((s) => s.costPrefs.autoEmbedCap);

  const wikilinkLookups = useMemo(
    () =>
      buildWikilinkLookups({
        notes: (allNotes ?? []).map((n) => ({
          id: n.id,
          title: n.title,
          updatedAt: n.updatedAt,
        })),
        sources: (sources ?? []).map((s) => ({
          id: s.id,
          title: s.title,
        })),
        concepts: (concepts ?? []).map((c) => ({
          id: c.id,
          name: c.label,
          updatedAt: c.updatedAt,
        })),
      }),
    [allNotes, sources, concepts],
  );

  // Drop the stale `?id=` when the targeted note was deleted from under us
  // (useNote → null). Skip when still loading (undefined).
  useEffect(() => {
    if (!noteIdParam) return;
    if (selectedNote === null) {
      router.replace(`/w/${workspaceId}/notes`, { scroll: false });
    }
  }, [noteIdParam, selectedNote, router, workspaceId]);

  const handleSelectNote = useCallback(
    (id: string) => {
      router.replace(`/w/${workspaceId}/notes?id=${id}`, { scroll: false });
    },
    [router, workspaceId],
  );

  const handleEditorChange = useCallback(
    async (doc: string) => {
      if (!noteIdParam) return;
      try {
        await updateNote(noteIdParam, { content: doc });
      } catch {
        // updateNote shouldn't really throw — Dexie write failures bubble
        // up as the editor's `dirty` state and retry on the next keystroke.
      }
    },
    [noteIdParam],
  );

  const handleWikilinkClick = useCallback(
    (detail: WikilinkClickDetail) => {
      const resolution = resolveWikilink(
        {
          target: detail.target,
          kind: detail.kind,
          alias: detail.alias ?? undefined,
        },
        wikilinkLookups,
      );

      if (resolution.exists && resolution.id) {
        if (resolution.kind === "note") {
          handleSelectNote(resolution.id);
          return;
        }
        if (resolution.kind === "source") {
          router.push(`/w/${workspaceId}/read/${resolution.id}`);
          return;
        }
        if (resolution.kind === "concept") {
          router.push(`/w/${workspaceId}/map?focus=${resolution.id}`);
          return;
        }
      }

      if (resolution.kind === "note") {
        // Obsidian-style click-to-create: missing note link spawns a fresh
        // doc with the target as its H1, then opens it in the editor.
        void (async () => {
          try {
            const created = await createNote({
              workspaceId,
              content: `# ${resolution.target}\n\n`,
            });
            toast({
              title: t("missing_link_toast", { title: resolution.target }),
              variant: "info",
            });
            handleSelectNote(created.id);
          } catch {
            toast({
              title: t("navigate_failed_toast"),
              variant: "error",
            });
          }
        })();
        return;
      }

      toast({
        title: t("missing_link_kind_toast", {
          kind: resolution.kind,
          target: resolution.target,
        }),
        variant: "warn",
      });
    },
    [wikilinkLookups, workspaceId, router, handleSelectNote, t, toast],
  );

  const handleTagClick = useCallback((detail: TagClickDetail) => {
    setActiveTagFilter(detail.tag);
    setLeftTab("tree");
  }, []);

  const handleClearTagFilter = useCallback(() => {
    setActiveTagFilter(null);
  }, []);

  const handleEditorReady = useCallback((view: EditorView | null) => {
    editorViewRef.current = view;
    // Tiny test-affordance: Playwright drives the editor via this handle to
    // dodge the CM6 + contentEditable race that flakes `locator.type` /
    // `pressSequentially`. Mirrors the `window.__useVault` shim seeded by
    // `seedUnlockedVault` — no user-facing functionality depends on it.
    if (typeof window !== "undefined") {
      (
        window as Window & { __tmeEditorView?: EditorView | null }
      ).__tmeEditorView = view;
    }
  }, []);

  const getEditorView = useCallback(() => editorViewRef.current, []);

  const handleCreateFromEmpty = useCallback(async () => {
    try {
      const created = await createNote({ workspaceId });
      handleSelectNote(created.id);
    } catch {
      toast({ title: t("navigate_failed_toast"), variant: "error" });
    }
  }, [workspaceId, handleSelectNote, t, toast]);

  const handleEmbedResult = useCallback(
    (result: {
      kind: "success" | "error" | "missing-prereq";
      reason?: EmbedderResolutionFailure;
      chunkCount?: number;
      embedsRun?: number;
      costUsd?: number;
      message?: string;
    }) => {
      if (result.kind === "success") {
        // `embedsRun: 0` means the orchestrator short-circuited on a matching
        // hash — surface a quieter toast so the user knows the click landed
        // but didn't bill them again for an unchanged note.
        if ((result.embedsRun ?? 0) === 0) {
          toast({
            title: t("embed_toast_success_reused"),
            variant: "info",
          });
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
        // Branch on the factory's reason so a locked vault doesn't get
        // misrouted to the "add an API key" message. `unknown-preset` and
        // `provider-unavailable` fall back to the generic copy — both are
        // misconfiguration paths the user can't fix from Settings → Keys.
        const titleKey =
          result.reason === "vault-locked"
            ? "embed_toast_vault_locked"
            : result.reason === "no-key"
              ? "embed_toast_no_key"
              : "embed_toast_missing_prereq";
        toast({
          title: t(titleKey),
          variant: "warn",
        });
        return;
      }
      toast({
        title: t("embed_toast_error", { message: result.message ?? "" }),
        variant: "error",
      });
    },
    [toast, t],
  );

  const resolveEmbedderForButton = useCallback(async () => {
    // Returns the full `EmbedderResolution` so the button can forward the
    // `reason` discriminator into the missing-prereq toast above. The auto-
    // sync timer below still calls `resolveEmbedderFromPrefs` directly and
    // reads `.handle` — that path is unaffected.
    return await resolveEmbedderFromPrefs();
  }, []);

  // Phase 6.9.5 — Per-note auto-sync. Fires `embedNoteAsSource` 5s after the
  // last keystroke when the note has `autoEmbedOnSave: true` AND the live
  // content's estimated cost is under the configured cap. We watch the
  // (selectedNote.content, autoEmbedOnSave, noteId) triplet — every keystroke
  // resets the timer; toggling the flag off mid-debounce cancels cleanly.
  useEffect(() => {
    // Cancel any timer from the previous render before scheduling a new one
    // so multiple keystrokes coalesce into a single trailing-edge call.
    if (autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current);
      autoSyncTimerRef.current = null;
    }
    if (!selectedNote) return;
    if (!selectedNote.autoEmbedOnSave) return;
    autoSyncNoteIdRef.current = selectedNote.id;
    const noteIdAtSchedule = selectedNote.id;
    const contentAtSchedule = selectedNote.content;
    const timer = setTimeout(() => {
      void (async () => {
        // Bail if the user switched notes during the debounce — the next
        // note's effect run already scheduled its own timer.
        if (autoSyncNoteIdRef.current !== noteIdAtSchedule) return;
        const resolution = await resolveEmbedderFromPrefs();
        if (!resolution.handle) {
          // Missing key / locked vault — silent on the auto path; the user
          // explicitly opted in, so a toast every 5s would be noisy.
          // They'll see the dirty button + tooltip in the toolbar instead.
          return;
        }
        const cost = estimateEmbedCost(
          contentAtSchedule,
          resolution.handle.pricePerMillionTokensUsd ?? 0,
        );
        if (autoEmbedCap > 0 && cost > autoEmbedCap) {
          toast({
            title: t("embed_toast_cost_cap_reached", {
              cap: autoEmbedCap.toFixed(2),
            }),
            variant: "warn",
          });
          return;
        }
        try {
          const result = await embedNoteAsSource(
            noteIdAtSchedule,
            resolution.handle,
          );
          if ((result.embedsRun ?? 0) > 0) {
            toast({
              title: t("embed_toast_auto_synced", {
                chunks: String(result.chunkCount),
              }),
              variant: "info",
            });
          }
        } catch {
          // Same rationale — opt-in autopath stays quiet on failure; the
          // button retains its dirty state so the user can retry manually.
        }
      })();
    }, 5_000);
    autoSyncTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
    };
  }, [
    selectedNote?.id,
    selectedNote?.content,
    selectedNote?.autoEmbedOnSave,
    selectedNote,
    autoEmbedCap,
    t,
    toast,
  ]);

  if (!workspaceId) {
    notFound();
  }

  if (workspace === null) {
    notFound();
  }

  const breadcrumb = workspace
    ? [pick(workspace.name, workspace.nameEn ?? workspace.name), t("breadcrumb")]
    : [pick("Yükleniyor…", "Loading…"), t("breadcrumb")];

  return (
    <AppShell
      workspaceId={workspaceId}
      title={t("title")}
      breadcrumb={breadcrumb}
    >
      <div
        className={cn(
          "grid h-full min-h-0 gap-3 px-3 py-3",
          leftCollapsed
            ? "lg:grid-cols-[40px_minmax(0,1fr)_320px]"
            : "lg:grid-cols-[280px_minmax(0,1fr)_320px]",
        )}
        data-testid="notes-page"
        data-left-collapsed={leftCollapsed ? "true" : "false"}
      >
        {/* LEFT — folder tree / tag panel switcher */}
        <div className="flex min-h-0 flex-col gap-2">
          {leftCollapsed ? (
            <button
              type="button"
              onClick={() => setLeftCollapsed(false)}
              className="hidden h-8 w-8 place-items-center rounded-[8px] border border-rule text-ink-3 transition-colors hover:border-accent hover:text-ink lg:grid"
              title={t("expand_left_panel")}
              aria-label={t("expand_left_panel")}
              data-testid="notes-left-expand"
            >
              <ChevronsRight className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div
                  role="tablist"
                  aria-label={t("title")}
                  className="inline-flex items-center gap-1 rounded-[10px] border border-rule bg-paper-2 p-1"
                >
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
                <button
                  type="button"
                  onClick={() => setLeftCollapsed(true)}
                  className="hidden h-8 w-8 place-items-center rounded-[8px] border border-rule text-ink-3 transition-colors hover:border-accent hover:text-ink lg:grid"
                  title={t("collapse_left_panel")}
                  aria-label={t("collapse_left_panel")}
                  data-testid="notes-left-collapse"
                >
                  <ChevronsLeft className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden rounded-[12px] border border-rule bg-paper">
                {leftTab === "tree" ? (
                  <NoteTree
                    workspaceId={workspaceId}
                    selectedNoteId={noteIdParam}
                    onSelectNote={handleSelectNote}
                    onNoteCreated={handleSelectNote}
                    activeTagFilter={activeTagFilter}
                    onClearTagFilter={handleClearTagFilter}
                  />
                ) : (
                  <TagPanel
                    workspaceId={workspaceId}
                    activeTag={activeTagFilter}
                    onTagSelect={(tag) => {
                      setActiveTagFilter(tag);
                      setLeftTab("tree");
                    }}
                    onClearFilter={handleClearTagFilter}
                  />
                )}
              </div>
            </>
          )}
        </div>

        {/* CENTER — editor or empty / loading */}
        <div className="flex min-h-0 flex-col">
          <CenterPane
            noteIdParam={noteIdParam}
            selectedNote={selectedNote}
            allNotesLoaded={allNotes !== undefined}
            hasAnyNote={(allNotes?.length ?? 0) > 0}
            wikilinkLookups={wikilinkLookups}
            onChange={handleEditorChange}
            onWikilinkClick={handleWikilinkClick}
            onTagClick={handleTagClick}
            onEditorReady={handleEditorReady}
            onCreate={handleCreateFromEmpty}
            resolveEmbedder={resolveEmbedderForButton}
            onEmbedResult={handleEmbedResult}
            emptyFirstTitle={t("empty_title")}
            emptyFirstDescription={t("empty_description")}
            emptyFirstCta={t("empty_cta")}
            emptyPickTitle={t("empty_pick_title")}
            emptyPickDescription={t("empty_pick_description")}
          />
        </div>

        {/* RIGHT — backlinks + outline */}
        <div className="hidden min-h-0 flex-col gap-3 lg:flex">
          <BacklinksPanel
            workspaceId={workspaceId}
            currentNoteTitle={selectedNote?.title ?? ""}
            currentNoteId={selectedNote?.id}
            onSelect={handleSelectNote}
            className="max-h-[50%]"
          />
          <OutlinePanel
            content={selectedNote?.content ?? ""}
            getView={getEditorView}
            className="min-h-0 flex-1"
          />
        </div>
      </div>
    </AppShell>
  );
}

type CenterPaneProps = {
  noteIdParam: string | undefined;
  selectedNote: ReturnType<typeof useNote>;
  /** True once `useNotesByWorkspace` has resolved (vs still undefined). */
  allNotesLoaded: boolean;
  /** True if the workspace has at least one note in Dexie. */
  hasAnyNote: boolean;
  wikilinkLookups: ReturnType<typeof buildWikilinkLookups>;
  onChange: (doc: string) => void | Promise<void>;
  onWikilinkClick: (detail: WikilinkClickDetail) => void;
  onTagClick: (detail: TagClickDetail) => void;
  onEditorReady: (view: EditorView | null) => void;
  onCreate: () => void | Promise<void>;
  /** Phase 6.9.5 — production embedder resolver passed into the toolbar button. */
  resolveEmbedder: () => Promise<
    import("@/components/notes/EmbedAsSourceButton").EmbedderResolveResult
  >;
  /** Toast surface for the button's success / error / missing-prereq paths. */
  onEmbedResult: (result: {
    kind: "success" | "error" | "missing-prereq";
    reason?: EmbedderResolutionFailure;
    chunkCount?: number;
    embedsRun?: number;
    costUsd?: number;
    message?: string;
  }) => void;
  /** Copy + CTA used when the workspace has zero notes. */
  emptyFirstTitle: string;
  emptyFirstDescription: string;
  emptyFirstCta: string;
  /** Copy used when notes exist but the user hasn't picked one. */
  emptyPickTitle: string;
  emptyPickDescription: string;
};

function CenterPane({
  noteIdParam,
  selectedNote,
  allNotesLoaded,
  hasAnyNote,
  wikilinkLookups,
  onChange,
  onWikilinkClick,
  onTagClick,
  onEditorReady,
  onCreate,
  resolveEmbedder,
  onEmbedResult,
  emptyFirstTitle,
  emptyFirstDescription,
  emptyFirstCta,
  emptyPickTitle,
  emptyPickDescription,
}: CenterPaneProps) {
  // Phase 6.8.1 — Empty pane forks on `hasAnyNote`:
  //   zero notes  → "Create your first note" with a primary CTA button
  //   notes exist → "Pick a note from the sidebar" hint, no big button
  // While the note list is still loading from Dexie we skip the variant
  // decision and render a Skeleton so the user doesn't see a misleading
  // first-note CTA flicker on a workspace that actually has notes.
  function renderEmpty() {
    if (!allNotesLoaded) {
      return <Skeleton variant="rect" height={480} />;
    }
    if (hasAnyNote) {
      return (
        <EmptyEditorPane
          title={emptyPickTitle}
          description={emptyPickDescription}
          cta={null}
          onCreate={onCreate}
        />
      );
    }
    return (
      <EmptyEditorPane
        title={emptyFirstTitle}
        description={emptyFirstDescription}
        cta={emptyFirstCta}
        onCreate={onCreate}
      />
    );
  }

  if (!noteIdParam) {
    return renderEmpty();
  }
  if (selectedNote === undefined) {
    return <Skeleton variant="rect" height={480} />;
  }
  if (!selectedNote) {
    return renderEmpty();
  }
  return (
    <NoteEditor
      key={selectedNote.id}
      initialContent={selectedNote.content}
      onChange={onChange}
      onWikilinkClick={onWikilinkClick}
      onTagClick={onTagClick}
      onEditorReady={onEditorReady}
      wikilinkLookups={wikilinkLookups}
      toolbarTrailingActions={
        <div className="flex items-center gap-1.5">
          <EmbedAsSourceButton
            noteId={selectedNote.id}
            content={selectedNote.content}
            resolveEmbedder={resolveEmbedder}
            onResult={onEmbedResult}
          />
          <EmbedAsSourceMenu
            noteId={selectedNote.id}
            autoEmbedOnSave={selectedNote.autoEmbedOnSave ?? false}
          />
        </div>
      }
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

function TabButton({
  active,
  onClick,
  icon,
  label,
  ariaLabel,
  testid,
}: TabButtonProps) {
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
        "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[12.5px] font-medium transition-colors",
        active
          ? "bg-paper text-ink shadow-sm"
          : "text-ink-3 hover:bg-paper-3 hover:text-ink",
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
  /** When null the CTA button is hidden — used for "no selection" hint state. */
  cta: string | null;
  onCreate: () => void | Promise<void>;
};

function EmptyEditorPane({
  title,
  description,
  cta,
  onCreate,
}: EmptyEditorPaneProps) {
  return (
    <div
      data-testid="notes-empty-pane"
      data-variant={cta ? "first" : "pick"}
      className="grid h-full place-items-center rounded-[12px] border border-dashed border-rule bg-paper-2/40 px-6 py-12 text-center"
    >
      <div className="flex max-w-md flex-col items-center gap-3">
        <div
          aria-hidden
          className="grid h-12 w-12 place-items-center rounded-full bg-paper-3 text-ink-3"
        >
          <NotebookPen className="h-5 w-5" />
        </div>
        <h2 className="font-display text-[20px] text-ink">{title}</h2>
        <p className="text-[13px] leading-5 text-ink-3">{description}</p>
        {cta ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void onCreate()}
            data-testid="notes-empty-create"
          >
            {cta}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
