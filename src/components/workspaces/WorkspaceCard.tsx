"use client";

// Phase 8 follow-up — extracted from dashboard/page.tsx so the workspaces
// listing page (`/workspaces`) can reuse the same card visual and
// delete-confirm flow. No behavior change vs the previous inline version.

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Chip } from "@/components/ui/Chip";
import { ConfirmDeleteModal } from "@/components/ui/ConfirmDeleteModal";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  useDueFlashcardCount,
  useHighlightCount,
  useSourceCount,
} from "@/lib/db/hooks";
import { deleteWorkspace } from "@/lib/db/workspaces";
import type { WorkspaceRecord } from "@/lib/db/types";

export function WorkspaceCard({
  workspace,
  onEdit,
  onDelete,
}: {
  workspace: WorkspaceRecord;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const pick = useLocalePick();
  const t = useTranslations("dashboard");
  const sourceCount = useSourceCount(workspace.id) ?? 0;
  const highlightCount = useHighlightCount(workspace.id) ?? 0;
  const dueCount = useDueFlashcardCount(workspace.id) ?? 0;
  const updated = new Date(workspace.updatedAt);
  const updatedLabel = updated.toLocaleDateString(pick("tr-TR", "en-US"), {
    day: "numeric",
    month: "short",
  });

  return (
    <div className="group relative rounded-[var(--radius-lg)] border border-rule bg-paper-2 p-4 shadow-[var(--shadow-soft)] transition-[background,border-color,transform] duration-[160ms] hover:-translate-y-[1px] hover:border-rule-strong hover:bg-paper-3">
      <Link
        href={`/w/${workspace.id}`}
        aria-label={pick(workspace.name, workspace.nameEn ?? workspace.name)}
        className="absolute inset-0 z-0 rounded-[var(--radius-lg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      />
      <div className="relative z-10 pointer-events-none">
        <div className="mb-4 flex items-start justify-between gap-4">
          <span
            className="grid h-9 w-9 place-items-center rounded-[10px] text-[13px] font-semibold text-white"
            style={{ backgroundColor: workspace.color }}
            aria-hidden
          >
            {workspace.initials}
          </span>
          {dueCount > 0 ? (
            <Chip>
              {dueCount} {pick("tekrar", "due")}
            </Chip>
          ) : null}
        </div>
        <h3 className="text-[17px] font-semibold leading-tight text-ink">
          {pick(workspace.name, workspace.nameEn ?? workspace.name)}
        </h3>
        {workspace.goal ? (
          <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-ink-3">
            {pick(workspace.goal, workspace.goalEn ?? workspace.goal)}
          </p>
        ) : (
          <p className="mt-2 text-[13px] leading-6 text-ink-4">
            {pick("Hedef yok", "No goal yet")}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-ink-3">
          <span>
            <b className="font-semibold text-ink-2">{sourceCount}</b>{" "}
            {t("kaynak")} · {highlightCount} {t("highlight")}
          </span>
          <span>{updatedLabel}</span>
        </div>
      </div>
      <div className="absolute right-2 top-2 z-20 flex gap-1 opacity-0 transition-opacity duration-[120ms] focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          aria-label={pick("Düzenle", "Edit")}
          className="grid h-7 w-7 place-items-center rounded-[8px] border border-rule bg-paper text-ink-3 transition-colors hover:bg-paper-3 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={pick("Sil", "Delete")}
          className="grid h-7 w-7 place-items-center rounded-[8px] border border-rule bg-paper text-ink-3 transition-colors hover:border-err hover:bg-err/10 hover:text-err focus:outline-none focus-visible:ring-2 focus-visible:ring-err"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function DeleteWorkspaceDialog({
  workspace,
  onClose,
  onDeleted,
  onError,
}: {
  workspace: WorkspaceRecord;
  onClose: () => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const pick = useLocalePick();
  const sourceCount = useSourceCount(workspace.id) ?? 0;
  const highlightCount = useHighlightCount(workspace.id) ?? 0;
  const cascade = [
    {
      label: pick("kaynak silinecek", "sources"),
      count: sourceCount,
    },
    {
      label: pick("highlight silinecek", "highlights"),
      count: highlightCount,
    },
  ];

  async function handleConfirm(): Promise<void> {
    try {
      await deleteWorkspace(workspace.id);
      onDeleted();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  const wsLabel = pick(workspace.name, workspace.nameEn ?? workspace.name);

  return (
    <ConfirmDeleteModal
      open
      onClose={onClose}
      onConfirm={handleConfirm}
      title={pick("Workspace'i sil", "Delete workspace")}
      description={pick(
        `"${wsLabel}" tamamen silinecek. Bu işlem geri alınamaz.`,
        `"${wsLabel}" will be permanently removed. This cannot be undone.`,
      )}
      cascade={cascade}
      confirmText={workspace.name}
      confirmInputLabel={
        <>
          {pick(
            "Onaylamak için workspace adını yaz: ",
            "To confirm, type the workspace name: ",
          )}
          <code className="font-mono text-[12.5px] text-err">
            {workspace.name}
          </code>
        </>
      }
      confirmButtonLabel={pick("Kalıcı olarak sil", "Delete permanently")}
      cancelButtonLabel={pick("İptal", "Cancel")}
    />
  );
}
