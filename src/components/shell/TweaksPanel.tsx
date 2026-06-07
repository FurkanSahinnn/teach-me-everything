"use client";

import { Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useLocalePick } from "@/i18n/IntlProvider";
import { type Locale, type ReaderWidth, usePrefs } from "@/stores/prefs";

const LOCALES: Array<{ value: Locale; label: string }> = [
  { value: "tr", label: "TR" },
  { value: "en", label: "EN" },
];

const READER_WIDTHS: Array<{
  value: ReaderWidth;
  trLabel: string;
  enLabel: string;
}> = [
  { value: "narrow", trLabel: "Dar", enLabel: "Narrow" },
  { value: "full", trLabel: "Tam", enLabel: "Full" },
];

// Inline appearance flyout: trigger button + anchored panel. Mirrors the
// outline flyout pattern (mousedown-outside / Escape to close). Used in the
// reader topbar; keeps the panel close to the rest of the controls instead
// of a fixed bottom-right floater.
export function TweaksPanel() {
  const locale = usePrefs((s) => s.locale);
  const setLocale = usePrefs((s) => s.setLocale);
  const readerWidth = usePrefs((s) => s.readerWidth);
  const setReaderWidth = usePrefs((s) => s.setReaderWidth);
  const pick = useLocalePick();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent): void {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={pick("Görünüm ayarları", "Appearance settings")}
        title={pick("Görünüm", "Appearance")}
        className="grid h-8 w-8 place-items-center rounded-md border border-rule bg-paper text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
      >
        <Settings2 className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open ? (
        <div
          ref={panelRef}
          role="menu"
          aria-label={pick("Görünüm ayarları", "Appearance settings")}
          className="absolute right-0 z-30 mt-2 w-[280px] rounded-xl border border-rule bg-paper shadow-[0_18px_44px_-14px_rgba(0,0,0,0.4)]"
        >
          <div className="px-3 pt-2.5 pb-1.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
              {pick("Görünüm", "Appearance")}
            </span>
          </div>
          <div className="flex flex-col gap-3 px-3 pb-3">
            <TweakRow label={pick("Tema", "Theme")}>
              <ThemeToggle />
            </TweakRow>
            <TweakRow label={pick("Dil", "Language")}>
              <SegmentedControl
                size="sm"
                value={locale}
                onChange={setLocale}
                mono
                options={LOCALES.map((l) => ({ value: l.value, label: l.label }))}
              />
            </TweakRow>
            <TweakRow label={pick("Genişlik", "Width")}>
              <SegmentedControl
                size="sm"
                value={readerWidth}
                onChange={setReaderWidth}
                mono
                options={READER_WIDTHS.map((w) => ({
                  value: w.value,
                  label: pick(w.trLabel, w.enLabel),
                }))}
              />
            </TweakRow>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TweakRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h4 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">
        {label}
      </h4>
      {children}
    </div>
  );
}
