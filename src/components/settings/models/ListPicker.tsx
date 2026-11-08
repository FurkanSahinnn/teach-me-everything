"use client";

import { Command } from "cmdk";
import { useRef, useState } from "react";

import { Check, ChevronDown, Search } from "@/components/icons";
import { useLocalePick } from "@/i18n/IntlProvider";
import { cn } from "@/lib/utils/cn";

import { AnchoredPopover } from "./AnchoredPopover";

export type ListPickerOption = {
  id: string;
  label: string;
  /** Short secondary line, e.g. capabilities or dimensions. */
  detail?: string;
};

const POPOVER_WIDTH = 420;
const POPOVER_HEIGHT = 380;

type Props = {
  label: string;
  value: string;
  options: readonly ListPickerOption[];
  onChange: (id: string) => void;
};

/** Searchable single-list picker with the same trigger and panel as the chat model picker. */
export function ListPicker({ label, value, options, onChange }: Props) {
  const pick = useLocalePick();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={pick(`${label} seç`, `Choose ${label}`)}
        className={cn(
          "flex w-full items-center gap-3 rounded-[var(--radius-sm)] border border-rule bg-paper px-3 py-2 text-left transition-colors sm:w-[300px]",
          "hover:border-rule-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          open && "border-rule-strong",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{selected?.label ?? value}</span>
          {selected?.detail ? <span className="block truncate text-[11.5px] text-ink-3">{selected.detail}</span> : null}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
      </button>
      <AnchoredPopover anchorRef={triggerRef} open={open} onClose={() => setOpen(false)} width={POPOVER_WIDTH} height={POPOVER_HEIGHT} label={label}>
        <Command className="flex min-h-0 w-full flex-col" loop>
          <div className="flex items-center gap-2 border-b border-rule px-3">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden />
            <Command.Input autoFocus placeholder={pick("Ara…", "Search…")} className="h-10 w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4" />
          </div>
          <Command.List className="min-h-0 flex-1 overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-6 text-center text-[12.5px] text-ink-4">{pick("Sonuç yok", "No results")}</Command.Empty>
            {options.map((o) => (
              <Command.Item
                key={o.id}
                value={`${o.label} ${o.id}`}
                onSelect={() => {
                  onChange(o.id);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-2.5 py-2 data-[selected=true]:bg-paper-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{o.label}</span>
                  {o.detail ? <span className="block truncate text-[11px] text-ink-4">{o.detail}</span> : null}
                </span>
                <Check className={cn("h-3.5 w-3.5 shrink-0 text-accent", o.id === value ? "opacity-100" : "opacity-0")} aria-hidden />
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </AnchoredPopover>
    </>
  );
}
