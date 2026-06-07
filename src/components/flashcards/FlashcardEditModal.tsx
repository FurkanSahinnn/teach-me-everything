"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDeleteModal } from "@/components/ui/ConfirmDeleteModal";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  deleteFlashcard,
  updateFlashcard,
} from "@/lib/db/flashcards";
import type { FlashcardRecord } from "@/lib/db/types";
import { cn } from "@/lib/utils/cn";

const QUESTION_MAX = 1000;
const ANSWER_MAX = 4000;

type FlashcardEditModalProps = {
  open: boolean;
  onClose: () => void;
  card: FlashcardRecord | null;
  onSaved?: () => void;
};

export function FlashcardEditModal({
  open,
  onClose,
  card,
  onSaved,
}: FlashcardEditModalProps) {
  const t = useTranslations("flashcard_edit");
  const pick = useLocalePick();
  const { toast } = useToast();
  const questionId = useId();
  const answerId = useId();
  const tagsId = useId();

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (!open || !card) return;
    const nextQuestion = card.question;
    const nextAnswer = card.answer;
    const nextTags = (card.tags ?? []).join(", ");
    queueMicrotask(() => {
      setQuestion(nextQuestion);
      setAnswer(nextAnswer);
      setTagsRaw(nextTags);
      setSubmitting(false);
    });
  }, [open, card]);

  const trimmedQuestion = question.trim();
  const trimmedAnswer = answer.trim();
  const tags = useMemo(
    () =>
      tagsRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    [tagsRaw],
  );
  const valid =
    trimmedQuestion.length > 0 &&
    trimmedAnswer.length > 0 &&
    trimmedQuestion.length <= QUESTION_MAX &&
    trimmedAnswer.length <= ANSWER_MAX;

  async function handleSave(): Promise<void> {
    if (!card || !valid || submitting) return;
    setSubmitting(true);
    try {
      await updateFlashcard(card.id, {
        question: trimmedQuestion,
        answer: trimmedAnswer,
        tags,
      });
      toast({
        variant: "success",
        title: t("toast_saved"),
      });
      onSaved?.();
      onClose();
    } catch (err) {
      toast({
        variant: "error",
        title: pick("Kaydedilemedi", "Save failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!card) return;
    try {
      await deleteFlashcard(card.id);
      toast({
        variant: "success",
        title: t("toast_deleted"),
      });
      setDeleteOpen(false);
      onClose();
    } catch (err) {
      toast({
        variant: "error",
        title: pick("Silinemedi", "Delete failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <>
      <Modal
        open={open && !deleteOpen}
        onClose={submitting ? () => {} : onClose}
        title={t("title")}
        size="lg"
        closeOnBackdrop={!submitting}
        closeOnEsc={!submitting}
        footer={
          <>
            <Button
              variant="danger"
              onClick={() => setDeleteOpen(true)}
              disabled={submitting || !card}
            >
              {t("delete")}
            </Button>
            <div className="flex-1" />
            <Button
              variant="default"
              onClick={onClose}
              disabled={submitting}
            >
              {pick("Vazgeç", "Cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!valid || submitting}
              loading={submitting}
            >
              {t("save")}
            </Button>
          </>
        }
      >
        {card ? (
          <div className="space-y-4">
            <div>
              <label
                htmlFor={questionId}
                className="mb-1.5 block text-[12.5px] font-medium text-ink-2"
              >
                {t("question_label")}
              </label>
              <textarea
                id={questionId}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={3}
                maxLength={QUESTION_MAX + 200}
                autoFocus
                className={cn(
                  "w-full resize-y rounded-[10px] border bg-paper px-3 py-2 text-[14px] text-ink",
                  "placeholder:text-ink-4",
                  "transition-[border-color,box-shadow] duration-[120ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
                  "focus:outline-none focus-visible:ring-2",
                  trimmedQuestion.length > QUESTION_MAX
                    ? "border-err focus-visible:border-err focus-visible:ring-err/30"
                    : "border-rule hover:border-rule-strong focus-visible:border-accent focus-visible:ring-accent/25",
                )}
              />
              <div className="mt-1 flex justify-end text-[11px] text-ink-4">
                <span
                  className={cn(
                    trimmedQuestion.length > QUESTION_MAX && "text-err",
                  )}
                >
                  {trimmedQuestion.length} / {QUESTION_MAX}
                </span>
              </div>
            </div>

            <div>
              <label
                htmlFor={answerId}
                className="mb-1.5 block text-[12.5px] font-medium text-ink-2"
              >
                {t("answer_label")}
              </label>
              <textarea
                id={answerId}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={6}
                maxLength={ANSWER_MAX + 500}
                className={cn(
                  "w-full resize-y rounded-[10px] border bg-paper px-3 py-2 text-[14px] text-ink",
                  "placeholder:text-ink-4",
                  "transition-[border-color,box-shadow] duration-[120ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
                  "focus:outline-none focus-visible:ring-2",
                  trimmedAnswer.length > ANSWER_MAX
                    ? "border-err focus-visible:border-err focus-visible:ring-err/30"
                    : "border-rule hover:border-rule-strong focus-visible:border-accent focus-visible:ring-accent/25",
                )}
              />
              <div className="mt-1 flex justify-end text-[11px] text-ink-4">
                <span
                  className={cn(
                    trimmedAnswer.length > ANSWER_MAX && "text-err",
                  )}
                >
                  {trimmedAnswer.length} / {ANSWER_MAX}
                </span>
              </div>
            </div>

            <div>
              <label
                htmlFor={tagsId}
                className="mb-1.5 block text-[12.5px] font-medium text-ink-2"
              >
                {t("tags_label")}
              </label>
              <input
                id={tagsId}
                type="text"
                value={tagsRaw}
                onChange={(e) => setTagsRaw(e.target.value)}
                placeholder={t("tags_hint")}
                className={cn(
                  "w-full rounded-[10px] border border-rule bg-paper px-3 py-[9px] text-[14px] text-ink",
                  "placeholder:text-ink-4",
                  "transition-[border-color,box-shadow] duration-[120ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
                  "focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25",
                )}
              />
              {tags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-md border border-rule bg-paper-2 px-2 py-0.5 text-[11.5px] text-ink-2"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
      <ConfirmDeleteModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title={t("delete_confirm_title")}
        description={t("delete_confirm_desc")}
        confirmText={pick("sil", "delete")}
        confirmInputLabel={pick(
          "Onaylamak için 'sil' yaz.",
          "Type 'delete' to confirm.",
        )}
        confirmButtonLabel={t("delete")}
        cancelButtonLabel={pick("Vazgeç", "Cancel")}
      />
    </>
  );
}
