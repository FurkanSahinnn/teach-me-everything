"use client";

import { CalendarDays, ChevronsDownUp, FilePlus, FolderPlus, NotebookPen, Search, Tag, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useMemo,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  useNoteFoldersByWorkspace,
  useNoteSourcesByWorkspace,
  useNotesByWorkspace,
} from "@/lib/db/hooks";
import {
  createNoteFolder,
  deleteNoteFolder,
  renameNoteFolder,
  moveNoteFolder,
  type FolderDeleteMode,
} from "@/lib/db/note-folders";
import {
  createNote,
  deleteNote,
  moveNote,
} from "@/lib/db/notes";
import { renameNoteTitleWithSweep } from "@/lib/notes/wikilink-rename";
import {
  findOrCreateDailyNote,
  formatDateForLocale,
  getDefaultDailyFolderName,
  getDefaultDailyTemplate,
} from "@/lib/notes/daily";
import {
  buildNoteTree,
  isDropForbidden,
  isTreeEmpty,
  readDragPayload,
  type DragPayload,
  type FolderNode,
  type NoteNode,
  type RootBucket,
  type TreeNode,
} from "@/lib/notes/tree";
import { usePrefs } from "@/stores/prefs";
import { cn } from "@/lib/utils/cn";
import {
  buildDragStartHandler,
  NoteTreeItem,
  type DropPosition,
} from "./NoteTreeItem";
import {
  NoteTreeContextMenu,
  type ContextMenuAction,
  type ContextMenuKind,
} from "./NoteTreeContextMenu";
import {
  DeleteFolderModal,
  type FolderDeleteChoice,
} from "./DeleteFolderModal";
import { DeleteNoteModal } from "./DeleteNoteModal";

export type NoteTreeProps = {
  workspaceId: string;
  /** Currently open note in the editor — highlights in the tree. */
  selectedNoteId?: string | undefined;
  onSelectNote: (id: string) => void;
  /** Fired after a brand-new note is created so the parent can open it. */
  onNoteCreated?: (id: string) => void;
  /**
   * Phase 6.6 — Lowercased `#tag` path that the surrounding shell (page or
   * sibling `TagPanel`) wants to filter the tree by. When null/undefined,
   * no filtering is applied. The tree owns the clear-X button and calls
   * `onClearTagFilter` to reset state in the parent.
   */
  activeTagFilter?: string | null | undefined;
  onClearTagFilter?: () => void;
};

type ContextTarget = {
  open: boolean;
  anchor: { x: number; y: number } | null;
  kind: ContextMenuKind;
  id: string;
  /** Folder name / note title for delete-modal hand-off. */
  label: string;
};

type RenameTarget = {
  kind: ContextMenuKind;
  id: string;
  initial: string;
} | null;

type DeleteFolderTarget = {
  id: string;
  name: string;
  noteCount: number;
  folderCount: number;
} | null;

type DeleteNoteTarget = { id: string; title: string } | null;

type DropTarget =
  | { kind: "folder"; id: string; position: DropPosition }
  | { kind: "root" }
  | null;

const ROOT_DROP_KEY = "__root__";

export function NoteTree({
  workspaceId,
  selectedNoteId,
  onSelectNote,
  onNoteCreated,
  activeTagFilter,
  onClearTagFilter,
}: NoteTreeProps): ReactNode {
  const t = useTranslations("notes.tree");
  const tActions = useTranslations("notes.tree.actions");
  const tTags = useTranslations("notes.tags");
  const folders = useNoteFoldersByWorkspace(workspaceId) ?? [];
  const notes = useNotesByWorkspace(workspaceId) ?? [];
  const expandedIds = usePrefs((s) => s.notesUi.expandedFolders);
  const toggleExpanded = usePrefs((s) => s.toggleNotesFolderExpanded);
  const setExpandedFolders = usePrefs((s) => s.setNotesExpandedFolders);
  const locale = usePrefs((s) => s.locale);
  const dailyTemplate = usePrefs((s) => s.notesUi.dailyTemplate);
  const dailyFolderName = usePrefs((s) => s.notesUi.dailyFolderName);

  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextTarget>({
    open: false,
    anchor: null,
    kind: "folder",
    id: "",
    label: "",
  });
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] =
    useState<DeleteFolderTarget>(null);
  const [deleteNoteTarget, setDeleteNoteTarget] =
    useState<DeleteNoteTarget>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  const expandedSet = useMemo(() => new Set(expandedIds), [expandedIds]);

  // Pre-compute descendants by folder id once per render so the per-row drop
  // forbidden check is O(1) instead of O(folders) per call.
  const descendantsByFolder = useMemo(() => {
    const childrenByParent = new Map<string, string[]>();
    for (const f of folders) {
      if (f.parentId === null) continue;
      const bucket = childrenByParent.get(f.parentId);
      if (bucket) bucket.push(f.id);
      else childrenByParent.set(f.parentId, [f.id]);
    }
    const cache = new Map<string, Set<string>>();
    function walk(id: string): Set<string> {
      const cached = cache.get(id);
      if (cached) return cached;
      const out = new Set<string>();
      const queue = [...(childrenByParent.get(id) ?? [])];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (out.has(cur)) continue;
        out.add(cur);
        const grand = childrenByParent.get(cur);
        if (grand) queue.push(...grand);
      }
      cache.set(id, out);
      return out;
    }
    return walk;
  }, [folders]);

  const tree: RootBucket = useMemo(
    () =>
      buildNoteTree({
        folders,
        notes,
        expandedFolderIds: expandedSet,
        searchQuery,
        activeTagFilter: activeTagFilter ?? null,
      }),
    [folders, notes, expandedSet, searchQuery, activeTagFilter],
  );

  // ─── Action handlers ────────────────────────────────────────────────────

  const handleCreateFolder = useCallback(
    async (parentId: string | null) => {
      const name = window.prompt(
        tActions("new_folder"),
        t("new_folder_default"),
      );
      if (name === null) return;
      const trimmed = name.trim();
      if (trimmed.length === 0) return;
      const created = await createNoteFolder({
        workspaceId,
        parentId,
        name: trimmed,
      });
      // Auto-expand parent + the new folder so the user sees it land.
      if (parentId !== null && !expandedSet.has(parentId)) {
        toggleExpanded(parentId);
      }
      if (!expandedSet.has(created.id)) toggleExpanded(created.id);
    },
    [workspaceId, expandedSet, toggleExpanded, t, tActions],
  );

  const handleCreateNote = useCallback(
    async (folderId: string | null) => {
      const created = await createNote({
        workspaceId,
        folderId,
        title: t("new_note_default"),
        // Seed with an H1 of the default title so the editor preview lands
        // on something the user can immediately overwrite.
        content: `# ${t("new_note_default")}\n\n`,
      });
      if (folderId !== null && !expandedSet.has(folderId)) {
        toggleExpanded(folderId);
      }
      onSelectNote(created.id);
      onNoteCreated?.(created.id);
    },
    [workspaceId, expandedSet, toggleExpanded, t, onSelectNote, onNoteCreated],
  );

  const handleCreateDaily = useCallback(async () => {
    const dailyLocale = locale === "tr" ? "tr" : "en";
    const folderName =
      dailyFolderName.trim().length > 0
        ? dailyFolderName
        : getDefaultDailyFolderName(dailyLocale);
    const template =
      dailyTemplate.trim().length > 0
        ? dailyTemplate
        : getDefaultDailyTemplate(dailyLocale);
    const dateString = formatDateForLocale(new Date(), dailyLocale);
    const { note } = await findOrCreateDailyNote({
      workspaceId,
      folderName,
      dateString,
      template,
      locale: dailyLocale,
    });
    if (note.folderId !== null && !expandedSet.has(note.folderId)) {
      toggleExpanded(note.folderId);
    }
    onSelectNote(note.id);
    onNoteCreated?.(note.id);
  }, [
    workspaceId,
    locale,
    dailyFolderName,
    dailyTemplate,
    expandedSet,
    toggleExpanded,
    onSelectNote,
    onNoteCreated,
  ]);

  const handleRenameCommit = useCallback(
    async (next: string) => {
      const target = renameTarget;
      setRenameTarget(null);
      if (!target) return;
      const trimmed = next.trim();
      if (trimmed.length === 0) return;
      if (target.kind === "folder") {
        await renameNoteFolder(target.id, trimmed);
      } else {
        // Phase 6.5 — atomic rename + sweep. The repo wrapper rewrites
        // every other note in the workspace whose `[[<old title>]]`
        // wikilinks need updating, then swaps the renamed note's H1.
        // Both writes happen inside one Dexie `rw` txn so a crash can't
        // leave dangling references.
        const note = notes.find((n) => n.id === target.id);
        if (!note) return;
        if (note.title === trimmed) return;
        await renameNoteTitleWithSweep(target.id, trimmed);
      }
    },
    [renameTarget, notes],
  );

  const handleRenameCancel = useCallback(() => {
    setRenameTarget(null);
  }, []);

  const startRename = useCallback(
    (kind: ContextMenuKind, id: string, label: string) => {
      setRenameTarget({ kind, id, initial: label });
    },
    [],
  );

  const promptDelete = useCallback(
    (kind: ContextMenuKind, id: string, label: string) => {
      if (kind === "note") {
        setDeleteNoteTarget({ id, title: label });
        return;
      }
      const counts = countFolderContents(id, folders, notes);
      setDeleteFolderTarget({
        id,
        name: label,
        noteCount: counts.noteCount,
        folderCount: counts.folderCount,
      });
    },
    [folders, notes],
  );

  const handleDeleteFolder = useCallback(
    async (choice: FolderDeleteChoice) => {
      const target = deleteFolderTarget;
      if (!target) return;
      const mode: FolderDeleteMode = { kind: choice };
      // If the editor is open on a note inside the doomed folder, clear
      // selection so the parent doesn't keep loading a deleted record.
      if (choice === "cascade" && selectedNoteId) {
        const cur = notes.find((n) => n.id === selectedNoteId);
        const cascadeIds = new Set([
          target.id,
          ...descendantsByFolder(target.id),
        ]);
        if (cur && cur.folderId !== null && cascadeIds.has(cur.folderId)) {
          // Selection moves to "no selection" — caller (NoteTree consumer)
          // owns the note id state, but we still drop the folder id from
          // prefs.expandedFolders below so the tree doesn't carry orphans.
        }
      }
      await deleteNoteFolder(target.id, mode);
      // Drop the folder + its descendants from the prefs expanded list so
      // a re-created folder with the same id (rare, but possible if a
      // backup is restored) doesn't auto-open.
      const stale = new Set([target.id, ...descendantsByFolder(target.id)]);
      const cleaned = expandedIds.filter((id) => !stale.has(id));
      if (cleaned.length !== expandedIds.length) {
        setExpandedFolders(cleaned);
      }
    },
    [
      deleteFolderTarget,
      selectedNoteId,
      notes,
      descendantsByFolder,
      expandedIds,
      setExpandedFolders,
    ],
  );

  const handleDeleteNote = useCallback(async () => {
    const target = deleteNoteTarget;
    if (!target) return;
    await deleteNote(target.id);
  }, [deleteNoteTarget]);

  // ─── Context menu dispatch ──────────────────────────────────────────────

  const handleMenuSelect = useCallback(
    (action: ContextMenuAction) => {
      const target = contextMenu;
      if (!target.id) return;
      if (action === "new_note") {
        void handleCreateNote(target.id);
      } else if (action === "new_folder") {
        void handleCreateFolder(target.id);
      } else if (action === "rename") {
        startRename(target.kind, target.id, target.label);
      } else if (action === "delete") {
        promptDelete(target.kind, target.id, target.label);
      }
    },
    [contextMenu, handleCreateNote, handleCreateFolder, startRename, promptDelete],
  );

  const openContextMenu = useCallback(
    (
      kind: ContextMenuKind,
      id: string,
      label: string,
      event: ReactMouseEvent,
    ) => {
      setContextMenu({
        open: true,
        anchor: { x: event.clientX, y: event.clientY },
        kind,
        id,
        label,
      });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu((c) => ({ ...c, open: false }));
  }, []);

  // ─── DnD ────────────────────────────────────────────────────────────────

  const onRowDragOver = useCallback(
    (
      kind: "folder" | "note",
      ownerFolderId: string | null,
      rowFolderOrNoteId: string,
      event: ReactDragEvent,
    ) => {
      const payload = readDragPayload(event.dataTransfer);
      if (!payload) return;
      const targetFolderId =
        kind === "folder" ? rowFolderOrNoteId : ownerFolderId;
      // Look up source row state for the forbidden check.
      const current =
        payload.kind === "note"
          ? { folderIdOfNote: notes.find((n) => n.id === payload.id)?.folderId ?? null }
          : { parentIdOfFolder: folders.find((f) => f.id === payload.id)?.parentId ?? null };
      const forbidden = isDropForbidden(
        payload,
        targetFolderId,
        current,
        descendantsByFolder,
      );
      if (forbidden) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (kind === "folder") {
        setDropTarget({ kind: "folder", id: rowFolderOrNoteId, position: "into" });
      } else {
        // Dropping onto a note row places into the same folder bucket the
        // note lives in; visually we just highlight the row's folder
        // ancestor or root.
        setDropTarget(
          ownerFolderId === null
            ? { kind: "root" }
            : { kind: "folder", id: ownerFolderId, position: "into" },
        );
      }
    },
    [folders, notes, descendantsByFolder],
  );

  const onRowDragLeave = useCallback((_event: ReactDragEvent) => {
    // Defer clearing — the next row's dragover will overwrite, and an
    // immediate clear causes flicker between adjacent rows.
    setTimeout(() => setDropTarget(null), 30);
  }, []);

  const performDrop = useCallback(
    async (payload: DragPayload, targetFolderId: string | null) => {
      if (payload.kind === "note") {
        await moveNote(payload.id, targetFolderId);
      } else {
        await moveNoteFolder(payload.id, targetFolderId);
      }
    },
    [],
  );

  const onRowDrop = useCallback(
    (
      kind: "folder" | "note",
      ownerFolderId: string | null,
      rowFolderOrNoteId: string,
      event: ReactDragEvent,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const payload = readDragPayload(event.dataTransfer);
      setDropTarget(null);
      if (!payload) return;
      const targetFolderId =
        kind === "folder" ? rowFolderOrNoteId : ownerFolderId;
      void performDrop(payload, targetFolderId);
    },
    [performDrop],
  );

  const onRootDragOver = useCallback(
    (event: ReactDragEvent) => {
      const payload = readDragPayload(event.dataTransfer);
      if (!payload) return;
      const current =
        payload.kind === "note"
          ? { folderIdOfNote: notes.find((n) => n.id === payload.id)?.folderId ?? null }
          : { parentIdOfFolder: folders.find((f) => f.id === payload.id)?.parentId ?? null };
      if (isDropForbidden(payload, null, current, descendantsByFolder)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget({ kind: "root" });
    },
    [folders, notes, descendantsByFolder],
  );

  const onRootDrop = useCallback(
    (event: ReactDragEvent) => {
      event.preventDefault();
      const payload = readDragPayload(event.dataTransfer);
      setDropTarget(null);
      if (!payload) return;
      void performDrop(payload, null);
    },
    [performDrop],
  );

  // ─── Render helpers ─────────────────────────────────────────────────────

  const itemLabels = useMemo(
    () => ({
      expand: t("expand_folder"),
      collapse: t("collapse_folder"),
      openMenu: t("open_menu"),
      untitledNote: t("untitled_note"),
      untitledFolder: t("untitled_folder"),
      renameSave: t("rename.save"),
      renameCancel: t("rename.cancel"),
      embeddedTooltip: t("embed_badge.tooltip"),
    }),
    [t],
  );

  // Phase 6.9.8 — workspace-wide note-source map for the Sparkles dot. One
  // hook call instead of N (per-row hook) so the live-query overhead stays
  // O(1) per workspace.
  const noteSourceMap = useNoteSourcesByWorkspace(workspaceId);

  const menuLabels = useMemo(
    () => ({
      new_note: tActions("new_note"),
      new_folder: tActions("new_folder"),
      rename: tActions("rename"),
      delete: tActions("delete"),
    }),
    [tActions],
  );

  function renderFolder(node: FolderNode): ReactNode {
    const indicator: DropPosition | null =
      dropTarget?.kind === "folder" && dropTarget.id === node.id
        ? dropTarget.position
        : null;
    return (
      <div key={`folder-${node.id}`}>
        <NoteTreeItem
          variant="folder"
          id={node.id}
          label={node.name}
          depth={node.depth}
          expanded={node.expanded}
          dropIndicator={indicator}
          renaming={renameTarget?.kind === "folder" && renameTarget.id === node.id}
          initialRenameValue={renameTarget?.initial}
          labels={itemLabels}
          onClick={() => toggleExpanded(node.id)}
          onContextMenu={(e) => openContextMenu("folder", node.id, node.name, e)}
          onMenuButtonClick={(e) =>
            openContextMenu("folder", node.id, node.name, e)
          }
          onToggleExpand={() => toggleExpanded(node.id)}
          onDragStart={buildDragStartHandler({ kind: "folder", id: node.id })}
          onDragOver={(e) => onRowDragOver("folder", node.parentId, node.id, e)}
          onDragLeave={onRowDragLeave}
          onDrop={(e) => onRowDrop("folder", node.parentId, node.id, e)}
          onRenameCommit={(v) => void handleRenameCommit(v)}
          onRenameCancel={handleRenameCancel}
        />
        {node.expanded ? (
          <div>
            {node.children.map((c) => renderTreeNode(c))}
            {node.notes.map((n) => renderNote(n, node.id))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderNote(node: NoteNode, ownerFolderId: string | null): ReactNode {
    return (
      <NoteTreeItem
        key={`note-${node.id}`}
        variant="note"
        id={node.id}
        label={node.title}
        depth={node.depth}
        selected={selectedNoteId === node.id}
        renaming={renameTarget?.kind === "note" && renameTarget.id === node.id}
        initialRenameValue={renameTarget?.initial}
        embedded={noteSourceMap.has(node.id)}
        labels={itemLabels}
        onClick={() => onSelectNote(node.id)}
        onContextMenu={(e) => openContextMenu("note", node.id, node.title, e)}
        onMenuButtonClick={(e) =>
          openContextMenu("note", node.id, node.title, e)
        }
        onDragStart={buildDragStartHandler({ kind: "note", id: node.id })}
        onDragOver={(e) =>
          onRowDragOver("note", ownerFolderId, node.id, e)
        }
        onDragLeave={onRowDragLeave}
        onDrop={(e) => onRowDrop("note", ownerFolderId, node.id, e)}
        onRenameCommit={(v) => void handleRenameCommit(v)}
        onRenameCancel={handleRenameCancel}
      />
    );
  }

  function renderTreeNode(node: TreeNode): ReactNode {
    if (node.kind === "folder") return renderFolder(node);
    return renderNote(node, node.folderId);
  }

  const empty = isTreeEmpty(tree);
  const searching = searchQuery.trim().length > 0;
  const tagFiltering = !!activeTagFilter && activeTagFilter.length > 0;
  const rootHighlighted = dropTarget?.kind === "root";

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-paper-2"
      data-testid="note-tree"
    >
      {/* Header: search + create actions */}
      <div className="flex flex-col gap-2 border-b border-rule px-3 py-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
            aria-hidden
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("search_placeholder")}
            data-testid="note-tree-search"
            className={cn(
              "h-7 w-full rounded-[8px] border border-rule bg-paper pl-7 pr-7 text-[12.5px] text-ink",
              "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
              "placeholder:text-ink-4",
            )}
          />
          {searchQuery.length > 0 ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label={t("search_clear")}
              className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-[4px] text-ink-3 hover:bg-paper-3 hover:text-ink"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleCreateDaily()}
            data-testid="note-tree-today"
            aria-label={tActions("today_aria")}
            title={tActions("today_aria")}
            className="h-7 px-2 text-[12px]"
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            <span>{tActions("today")}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleCreateFolder(null)}
            data-testid="note-tree-new-folder"
            className="h-7 px-2 text-[12px]"
          >
            <FolderPlus className="h-3.5 w-3.5" aria-hidden />
            <span>{t("create_folder_top")}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleCreateNote(null)}
            data-testid="note-tree-new-note"
            className="h-7 px-2 text-[12px]"
          >
            <FilePlus className="h-3.5 w-3.5" aria-hidden />
            <span>{t("create_note_top")}</span>
          </Button>
          {expandedIds.length > 0 ? (
            <button
              type="button"
              onClick={() => setExpandedFolders([])}
              aria-label={t("collapse_all")}
              title={t("collapse_all")}
              className="ml-auto grid h-7 w-7 place-items-center rounded-[6px] text-ink-3 hover:bg-paper-3 hover:text-ink"
              data-testid="note-tree-collapse-all"
            >
              <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        {tagFiltering && activeTagFilter ? (
          <div
            className="flex items-center gap-1.5 rounded-md border border-accent-soft bg-accent-wash px-2 py-1"
            data-testid="note-tree-active-tag-filter"
          >
            <Tag className="h-3 w-3 text-accent" aria-hidden />
            <span className="flex-1 truncate text-[11.5px] font-medium text-accent-ink">
              #{activeTagFilter}
            </span>
            {onClearTagFilter ? (
              <button
                type="button"
                onClick={onClearTagFilter}
                aria-label={tTags("clear_filter")}
                className="grid h-4 w-4 place-items-center rounded text-accent-ink hover:bg-accent-soft"
                data-testid="note-tree-clear-tag-filter"
              >
                <X className="h-2.5 w-2.5" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Body: tree or empty state */}
      <div
        className={cn(
          "flex-1 overflow-y-auto px-1.5 py-1.5",
          rootHighlighted && "bg-accent-soft/20",
        )}
        onDragOver={onRootDragOver}
        onDrop={onRootDrop}
        data-testid="note-tree-body"
        data-drop-target-root={rootHighlighted ? "true" : "false"}
        data-drop-key={ROOT_DROP_KEY}
      >
        {empty ? (
          searching ? (
            <EmptyState
              icon={<Search />}
              title={t("empty_search_title")}
              description={t("empty_search_description", { query: searchQuery })}
            />
          ) : tagFiltering && activeTagFilter ? (
            <EmptyState
              icon={<Tag />}
              title={tTags("empty_filter_title")}
              description={tTags("empty_filter_description", {
                tag: activeTagFilter,
              })}
            />
          ) : (
            <EmptyState
              icon={<NotebookPen />}
              title={t("empty_title")}
              description={t("empty_description")}
              action={{
                label: t("empty_cta"),
                onClick: () => void handleCreateNote(null),
              }}
            />
          )
        ) : (
          <div className="flex flex-col gap-px">
            {tree.folders.map((f) => renderFolder(f))}
            {tree.notes.map((n) => renderNote(n, null))}
          </div>
        )}
      </div>

      {/* Context menu */}
      <NoteTreeContextMenu
        open={contextMenu.open}
        anchor={contextMenu.anchor}
        kind={contextMenu.kind}
        labels={menuLabels}
        onSelect={handleMenuSelect}
        onClose={closeContextMenu}
      />

      {/* Delete modals */}
      <DeleteFolderModal
        open={deleteFolderTarget !== null}
        folderName={deleteFolderTarget?.name ?? ""}
        noteCount={deleteFolderTarget?.noteCount ?? 0}
        folderCount={deleteFolderTarget?.folderCount ?? 0}
        onClose={() => setDeleteFolderTarget(null)}
        onConfirm={handleDeleteFolder}
      />
      <DeleteNoteModal
        open={deleteNoteTarget !== null}
        noteTitle={deleteNoteTarget?.title ?? ""}
        onClose={() => setDeleteNoteTarget(null)}
        onConfirm={handleDeleteNote}
      />
    </div>
  );
}

// Walk the folder tree to count direct + descendant notes inside a folder.
// Used to populate the "X notes, Y subfolders" copy in DeleteFolderModal.
function countFolderContents(
  folderId: string,
  folders: Array<{ id: string; parentId: string | null }>,
  notes: Array<{ folderId: string | null }>,
): { noteCount: number; folderCount: number } {
  const childrenByParent = new Map<string, string[]>();
  for (const f of folders) {
    if (f.parentId === null) continue;
    const bucket = childrenByParent.get(f.parentId);
    if (bucket) bucket.push(f.id);
    else childrenByParent.set(f.parentId, [f.id]);
  }
  const allFolders = new Set<string>([folderId]);
  const queue = [folderId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const kids = childrenByParent.get(cur);
    if (!kids) continue;
    for (const k of kids) {
      if (!allFolders.has(k)) {
        allFolders.add(k);
        queue.push(k);
      }
    }
  }
  let noteCount = 0;
  for (const n of notes) {
    if (n.folderId !== null && allFolders.has(n.folderId)) noteCount++;
  }
  return { noteCount, folderCount: allFolders.size - 1 };
}

