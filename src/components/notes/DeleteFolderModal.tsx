"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export type FolderDeleteChoice = "cascade" | "move-to-root";

export type DeleteFolderModalProps = {
  open: boolean;
  folderName: string;
  /** Direct child note count (folder-level, not recursive). */
  noteCount: number;
  /** Direct child folder count. */
  folderCount: number;
  onClose: () => void;
  /**
   * Called with the user's choice. For empty folders this is always
   * `"cascade"` so the caller can use the same `deleteNoteFolder(id, mode)`
   * call site regardless of folder contents.
   */
  onConfirm: (choice: FolderDeleteChoice) => Promise<void> | void;
};

export function DeleteFolderModal({
  open,
  folderName,
  noteCount,
  folderCount,
  onClose,
  onConfirm,
}: DeleteFolderModalProps): ReactNode {
  const t = useTranslations("notes.tree.delete_folder");
  const [submitting, setSubmitting] = useState(false);

  const isEmpty = noteCount === 0 && folderCount === 0;
  const description = isEmpty
    ? t("description_empty", { name: folderName })
    : noteCount > 0 && folderCount > 0
      ? t("description_with_notes", {
          name: folderName,
          noteCount,
          folderCount,
        })
      : noteCount > 0
        ? t("description_notes_only", { name: folderName, noteCount })
        : t("description_subfolders_only", { name: folderName, folderCount });

  async function handle(choice: FolderDeleteChoice): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(choice);
    } finally {
      setSubmitting(false);
      onClose();
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={t("title")}
      description={description}
      size="sm"
      footer={
        isEmpty ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => handle("cascade")}
              disabled={submitting}
              data-testid="delete-folder-empty"
            >
              {t("delete_empty")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={submitting}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => handle("move-to-root")}
              disabled={submitting}
              data-testid="delete-folder-move-to-root"
            >
              {t("move_to_root")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => handle("cascade")}
              disabled={submitting}
              data-testid="delete-folder-cascade"
            >
              {t("cascade")}
            </Button>
          </div>
        )
      }
    >
      {/* Description carries the full message; body intentionally empty. */}
    </Modal>
  );
}
