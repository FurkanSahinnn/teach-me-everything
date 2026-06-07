"use client";

/**
 * Phase 6.6 — Sidebar tag panel for the notes vault.
 *
 * Lists every inline `#tag` parsed out of the workspace's notes (via the
 * denormalised `tags[]` multiEntry index, summed in `useTagsByWorkspace`).
 * Nested tags `#kimya/organik/halkalı` render as a collapsible tree via
 * `buildTagTree`; parents show a rolled-up `totalCount` while leaves show
 * the direct count.
 *
 * Layout mirrors `BacklinksPanel`: compact header w/ count chip, scrollable
 * tree, kind-aware empty state. Selecting a tag fires `onTagSelect(tag)`
 * so the parent can drive a `NoteTree` filter or workspace-page route.
 */

import { ChevronDown, ChevronRight, Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useTagsByWorkspace } from "@/lib/db/hooks";
import { buildTagTree, isTagTreeEmpty, type TagTreeNode } from "@/lib/notes/tag-tree";
import { cn } from "@/lib/utils/cn";

export type TagPanelProps = {
  workspaceId: string;
  /** Lowercased tag path that is currently filtering the note list, if any. */
  activeTag?: string | null;
  /** Fires when the user clicks a tag row. */
  onTagSelect?: (tag: string) => void;
  /** Fires when the user clicks the clear-filter button. */
  onClearFilter?: () => void;
  className?: string;
};

export function TagPanel({
  workspaceId,
  activeTag,
  onTagSelect,
  onClearFilter,
  className,
}: TagPanelProps) {
  const t = useTranslations("notes.tags");
  const tagCounts = useTagsByWorkspace(workspaceId) ?? new Map<string, number>();
  const tree = useMemo(() => buildTagTree({ tagCounts }), [tagCounts]);
  const totalTags = tagCounts.size;

  // Track which branches are expanded. Start with everything collapsed —
  // most workspaces have a small flat tag set, and nested vocabularies
  // typically have a handful of parents the user explicitly drills into.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (fullPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });
  };

  return (
    <aside
      className={cn(
        "flex w-full flex-col rounded-lg border border-rule-soft bg-paper",
        className,
      )}
      aria-label={t("title")}
    >
      <header className="flex items-center justify-between gap-2 border-b border-rule-soft px-3 py-2">
        <div className="flex items-center gap-2">
          <Tag className="h-3.5 w-3.5 text-ink-3" aria-hidden />
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
            {t("title")}
          </h2>
          {totalTags > 0 ? (
            <span
              className="rounded-full bg-paper-2 px-1.5 py-[1px] font-mono text-[10px] text-ink-3"
              aria-label={t("count_aria", { count: totalTags })}
            >
              {totalTags}
            </span>
          ) : null}
        </div>
        {activeTag && onClearFilter ? (
          <button
            type="button"
            onClick={onClearFilter}
            className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3 hover:bg-paper-2 hover:text-ink"
          >
            {t("clear_filter")}
          </button>
        ) : null}
      </header>

      {isTagTreeEmpty(tree) ? (
        <div className="px-4 py-6 text-center">
          <p className="font-serif text-[14px] text-ink">{t("empty_title")}</p>
          <p className="mt-1 text-[12px] leading-5 text-ink-3">
            {t("empty_description")}
          </p>
        </div>
      ) : (
        <ul role="tree" className="flex flex-col gap-0.5 px-2 py-2 text-[13px]">
          {tree.map((node) => (
            <TagRow
              key={node.fullPath}
              node={node}
              expanded={expanded}
              activeTag={activeTag ?? null}
              onToggle={toggle}
              onSelect={onTagSelect}
            />
          ))}
        </ul>
      )}
    </aside>
  );
}

type TagRowProps = {
  node: TagTreeNode;
  expanded: ReadonlySet<string>;
  activeTag: string | null;
  onToggle: (fullPath: string) => void;
  onSelect: ((tag: string) => void) | undefined;
};

function TagRow({ node, expanded, activeTag, onToggle, onSelect }: TagRowProps) {
  const isExpanded = expanded.has(node.fullPath);
  const isActive = activeTag === node.fullPath;
  const hasChildren = node.children.length > 0;
  const indent = 8 + node.depth * 12;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md py-1 pr-2 transition-colors",
          isActive
            ? "bg-accent-wash text-accent-ink"
            : "hover:bg-paper-2",
        )}
        style={{ paddingLeft: `${indent}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.fullPath)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-paper-3 hover:text-ink"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" aria-hidden />
            ) : (
              <ChevronRight className="h-3 w-3" aria-hidden />
            )}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => onSelect?.(node.fullPath)}
          className={cn(
            "flex flex-1 items-center gap-2 truncate text-left text-[12.5px] font-medium",
            isActive ? "text-accent-ink" : "text-ink",
          )}
        >
          <span className="truncate">
            <span className="text-ink-3">#</span>
            {node.segment}
          </span>
          <span
            className={cn(
              "ml-auto rounded-full px-1.5 py-[1px] font-mono text-[10px]",
              isActive
                ? "bg-accent text-paper"
                : "bg-paper-2 text-ink-3 group-hover:bg-paper-3",
            )}
          >
            {hasChildren ? node.totalCount : node.directCount}
          </span>
        </button>
      </div>
      {hasChildren && isExpanded ? (
        <ul role="group" className="flex flex-col gap-0.5">
          {node.children.map((child) => (
            <TagRow
              key={child.fullPath}
              node={child}
              expanded={expanded}
              activeTag={activeTag}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
