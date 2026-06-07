"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export type DeleteNoteModalProps = {
  open: boolean;
  noteTitle: string;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
};

export function DeleteNoteModal({
  open,
  noteTitle,
  onClose,
  onConfirm,
}: DeleteNoteModalProps): ReactNode {
  const t = useTranslations("notes.tree.delete_note");
  const [submitting, setSubmitting] = useState(false);

  async function handle(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
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
      description={t("description", { title: noteTitle })}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            {t("cancel")}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handle}
            disabled={submitting}
            data-testid="delete-note-confirm"
          >
            {t("confirm")}
          </Button>
        </div>
      }
    />
  );
}
