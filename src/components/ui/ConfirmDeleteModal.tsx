"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { Input } from "./Input";

type CascadeRow = { label: string; count: number };

type ConfirmDeleteModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  description?: ReactNode;
  cascade?: CascadeRow[];
  confirmText: string;
  confirmInputLabel: ReactNode;
  confirmButtonLabel: string;
  cancelButtonLabel: string;
};

export function ConfirmDeleteModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  cascade,
  confirmText,
  confirmInputLabel,
  confirmButtonLabel,
  cancelButtonLabel,
}: ConfirmDeleteModalProps) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const matches = typed.trim() === confirmText;

  useEffect(() => {
    if (!open) {
      queueMicrotask(() => {
        setTyped("");
        setSubmitting(false);
      });
    }
  }, [open]);

  async function handleConfirm(): Promise<void> {
    if (!matches || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={title}
      description={description}
      size="md"
      closeOnBackdrop={!submitting}
      closeOnEsc={!submitting}
      footer={
        <>
          <Button variant="default" onClick={onClose} disabled={submitting}>
            {cancelButtonLabel}
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            disabled={!matches || submitting}
            loading={submitting}
          >
            {confirmButtonLabel}
          </Button>
        </>
      }
    >
      {cascade && cascade.length > 0 ? (
        <div className="mb-4 rounded-[10px] border border-err/35 bg-err/10 p-3">
          <ul className="m-0 grid grid-cols-1 gap-1 text-[13px] text-ink sm:grid-cols-2">
            {cascade.map((c) => (
              <li key={c.label} className="flex items-baseline gap-2">
                <span className="font-mono text-[14px] font-semibold text-err">
                  {c.count}
                </span>
                <span className="text-ink-2">{c.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <label
        htmlFor={inputId}
        className="mb-2 block text-[13px] leading-5 text-ink-2"
      >
        {confirmInputLabel}
      </label>
      <Input
        id={inputId}
        autoFocus
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={confirmText}
        invalid={typed.length > 0 && !matches}
        autoComplete="off"
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches && !submitting) {
            e.preventDefault();
            void handleConfirm();
          }
        }}
      />
    </Modal>
  );
}
