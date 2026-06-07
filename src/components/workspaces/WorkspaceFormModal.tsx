"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { createWorkspace, updateWorkspace } from "@/lib/db/workspaces";
import {
  WORKSPACE_COLORS,
  deriveInitials,
} from "@/lib/utils/workspace-colors";
import { useLocalePick } from "@/i18n/IntlProvider";
import { cn } from "@/lib/utils/cn";
import type { WorkspaceRecord } from "@/lib/db/types";

export type WorkspaceFormMode = "create" | "edit";

type Props = {
  open: boolean;
  onClose: () => void;
  mode: WorkspaceFormMode;
  initial?: WorkspaceRecord | null | undefined;
};

const FORM_ID = "workspace-form";

export function WorkspaceFormModal({ open, onClose, mode, initial }: Props) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [initials, setInitials] = useState("");
  const [initialsTouched, setInitialsTouched] = useState(false);
  const [color, setColor] = useState<string>(WORKSPACE_COLORS[0]!.hex);
  const [goal, setGoal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; initials?: string }>(
    {},
  );

  const nameId = useId();
  const initialsId = useId();
  const goalId = useId();

  useEffect(() => {
    if (!open) return;
    let nextName = "";
    let nextInitials = "";
    let nextColor = WORKSPACE_COLORS[0]!.hex;
    let nextGoal = "";
    let nextInitialsTouched = false;
    if (mode === "edit" && initial) {
      nextName = initial.name;
      nextInitials = initial.initials;
      nextColor = initial.color;
      nextGoal = initial.goal ?? "";
      nextInitialsTouched = true;
    }
    queueMicrotask(() => {
      setName(nextName);
      setInitials(nextInitials);
      setColor(nextColor);
      setGoal(nextGoal);
      setInitialsTouched(nextInitialsTouched);
      setErrors({});
    });
  }, [open, mode, initial]);

  useEffect(() => {
    if (!initialsTouched) {
      const nextInitials = deriveInitials(name);
      queueMicrotask(() => setInitials(nextInitials));
    }
  }, [name, initialsTouched]);

  function validate(): boolean {
    const next: { name?: string; initials?: string } = {};
    const trimmedName = name.trim();
    if (!trimmedName) {
      next.name = pick("Ad gerekli", "Name is required");
    } else if (trimmedName.length > 80) {
      next.name = pick("En fazla 80 karakter", "Max 80 characters");
    }
    const initLen = initials.trim().length;
    if (initLen === 0) {
      next.initials = pick("İnisiyaller gerekli", "Initials required");
    } else if (initLen > 3) {
      next.initials = pick("En fazla 3 karakter", "Max 3 characters");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const trimmedGoal = goal.trim();
      const payload = {
        name: name.trim(),
        color,
        initials: initials.trim().toUpperCase(),
        ...(trimmedGoal ? { goal: trimmedGoal } : {}),
      };
      if (mode === "create") {
        await createWorkspace(payload);
        toast({
          variant: "success",
          title: pick("Workspace oluşturuldu", "Workspace created"),
        });
      } else if (initial) {
        await updateWorkspace(initial.id, payload);
        toast({
          variant: "success",
          title: pick("Workspace güncellendi", "Workspace updated"),
        });
      }
      onClose();
    } catch (err) {
      toast({
        variant: "error",
        title: pick("İşlem başarısız", "Action failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={
        mode === "create"
          ? pick("Yeni workspace", "New workspace")
          : pick("Workspace düzenle", "Edit workspace")
      }
      description={pick(
        "Bir konu için boş alan; ad, renk ve inisiyaller seç.",
        "Empty space for a topic — pick a name, color and initials.",
      )}
      size="md"
      closeOnBackdrop={!submitting}
      closeOnEsc={!submitting}
      footer={
        <>
          <Button
            variant="default"
            onClick={onClose}
            disabled={submitting}
          >
            {pick("İptal", "Cancel")}
          </Button>
          <Button
            type="submit"
            variant="accent"
            form={FORM_ID}
            loading={submitting}
            disabled={submitting}
          >
            {mode === "create"
              ? pick("Oluştur", "Create")
              : pick("Kaydet", "Save")}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor={nameId}
            className="mb-1.5 block text-[12.5px] font-medium text-ink-2"
          >
            {pick("Ad", "Name")}
          </label>
          <Input
            id={nameId}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            invalid={Boolean(errors.name)}
            placeholder={pick(
              "Örn. Kuantum Alan Teorisi",
              "e.g. Quantum Field Theory",
            )}
            maxLength={80}
            required
          />
          {errors.name ? (
            <p className="mt-1 text-[12px] text-err">{errors.name}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
          <div>
            <label
              htmlFor={goalId}
              className="mb-1.5 block text-[12.5px] font-medium text-ink-2"
            >
              {pick("Hedef (opsiyonel)", "Goal (optional)")}
            </label>
            <Input
              id={goalId}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={pick(
                "Örn. 6 ayda RG akışı",
                "e.g. RG flow in 6 months",
              )}
              maxLength={140}
            />
          </div>
          <div>
            <label
              htmlFor={initialsId}
              className="mb-1.5 block text-[12.5px] font-medium text-ink-2"
            >
              {pick("İnisiyaller", "Initials")}
            </label>
            <Input
              id={initialsId}
              value={initials}
              onChange={(e) => {
                setInitialsTouched(true);
                setInitials(e.target.value.slice(0, 3).toUpperCase());
              }}
              variant="mono"
              maxLength={3}
              invalid={Boolean(errors.initials)}
            />
            {errors.initials ? (
              <p className="mt-1 text-[12px] text-err">{errors.initials}</p>
            ) : null}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">
            {pick("Renk", "Color")}
          </span>
          <div
            role="radiogroup"
            aria-label={pick("Renk seçimi", "Color selection")}
            className="flex flex-wrap gap-2"
          >
            {WORKSPACE_COLORS.map((c) => {
              const selected = c.hex === color;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={pick(c.nameTr, c.nameEn)}
                  onClick={() => setColor(c.hex)}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-[10px] border-2 transition-[transform,border-color] duration-[120ms]",
                    selected
                      ? "scale-105 border-ink"
                      : "border-rule-soft hover:border-rule-strong",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
                  )}
                >
                  <span
                    className="h-5 w-5 rounded-[6px]"
                    style={{ backgroundColor: c.hex }}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-[10px] border border-rule-soft bg-paper-2 p-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] text-[13px] font-semibold text-white"
            style={{ backgroundColor: color }}
            aria-hidden
          >
            {initials || "—"}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-ink">
              {name || pick("Workspace adı", "Workspace name")}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-ink-3">
              {goal || pick("Hedef yok", "No goal yet")}
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}
