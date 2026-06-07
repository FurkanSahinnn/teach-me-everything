"use client";

import {
  Bell,
  ChevronRight,
  HelpCircle,
  Menu,
  Plus,
  Receipt,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { ShortcutsHelpModal } from "@/components/shortcuts/ShortcutsHelpModal";
import { PALETTE_OPEN_EVENT } from "@/components/tray/EventBridgeMount";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Kbd } from "@/components/ui/Kbd";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useTotalCost } from "@/lib/db/hooks";
import { cn } from "@/lib/utils/cn";

type TopbarProps = {
  title?: string | undefined;
  breadcrumb?: string[] | undefined;
  actions?: React.ReactNode | undefined;
  className?: string | undefined;
  onMenuClick?: () => void;
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
};

export function Topbar({
  title,
  breadcrumb,
  actions,
  className,
  onMenuClick,
  searchOpen,
  onSearchOpenChange,
}: TopbarProps) {
  const pick = useLocalePick();
  const [query, setQuery] = useState("");
  const [internalSearch, setInternalSearch] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const isSearchOpen = searchOpen ?? internalSearch;
  const setSearchOpen = onSearchOpenChange ?? setInternalSearch;

  useEffect(() => {
    if (!isSearchOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSearchOpen, setSearchOpen]);

  // Global ⌘K / Ctrl+K shortcut — opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Phase 7.5.B-tail — Native menu / tray Cmd+K routes through the
  // EventBridgeMount and surfaces here as a window CustomEvent so the
  // palette open state stays encapsulated in Topbar.
  useEffect(() => {
    const onPaletteOpen = (): void => setPaletteOpen(true);
    window.addEventListener(PALETTE_OPEN_EVENT, onPaletteOpen);
    return () => window.removeEventListener(PALETTE_OPEN_EVENT, onPaletteOpen);
  }, []);

  // Global "?" shortcut — opens the keyboard-shortcuts help modal. Skipped
  // when focus is in an input/textarea/contenteditable so the user can type a
  // literal "?" without triggering the dialog. Mobile (<md) keyboards rarely
  // surface bare "?", so we don't bother gating on viewport width — the modal
  // itself handles being mobile-unfriendly via its `<md` class hidden trigger.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "?") return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (target.isContentEditable) return;
      }
      event.preventDefault();
      setHelpOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-rule bg-paper/85 px-3 backdrop-blur-md",
          "md:gap-3 md:px-5",
          className,
        )}
      >
        <button
          type="button"
          onClick={onMenuClick}
          aria-label={pick("Menüyü aç", "Open menu")}
          className={cn(
            "grid h-9 w-9 place-items-center rounded-[10px] text-ink-2",
            "transition-colors duration-[120ms] hover:bg-paper-2 active:bg-paper-3",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            "md:hidden",
          )}
        >
          <Menu className="h-[18px] w-[18px]" aria-hidden />
        </button>

        {breadcrumb && breadcrumb.length > 0 ? (
          <nav className="hidden min-w-0 items-center gap-1.5 text-[13px] text-ink-3 md:flex">
            {breadcrumb.map((segment, i) => (
              <span
                key={`${segment}-${i}`}
                className="inline-flex min-w-0 items-center gap-1.5"
              >
                {i > 0 ? (
                  <ChevronRight
                    className="h-3 w-3 shrink-0 text-ink-4"
                    aria-hidden
                  />
                ) : null}
                <span
                  className={cn(
                    "truncate",
                    i === breadcrumb.length - 1 && "text-ink font-medium",
                  )}
                >
                  {segment}
                </span>
              </span>
            ))}
          </nav>
        ) : title ? (
          <h1 className="truncate text-[14px] font-medium text-ink">{title}</h1>
        ) : null}

        <div className="grow" />

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label={pick("Komut paleti", "Command palette")}
          title={pick("⌘K ile aç", "Open with ⌘K")}
          className={cn(
            "relative hidden h-9 w-[320px] items-center gap-2 rounded-[10px] border border-rule",
            "bg-paper-2 px-3 text-left text-[13px] text-ink-4 transition-colors",
            "hover:border-ink-5 hover:bg-paper-3 hover:text-ink-3",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            "lg:flex",
          )}
        >
          <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-4" />
          <span className="flex-1 truncate">
            {pick("Ara…", "Search…")}
          </span>
          <Kbd className="ml-auto">⌘K</Kbd>
        </button>

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label={pick("Ara", "Search")}
          className={cn(
            "grid h-9 w-9 place-items-center rounded-[10px] text-ink-2",
            "transition-colors duration-[120ms] hover:bg-paper-2 active:bg-paper-3",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            "lg:hidden",
          )}
        >
          <Search className="h-4 w-4" aria-hidden />
        </button>

        <Button
          size="sm"
          variant="default"
          className="hidden px-3 sm:inline-flex xl:px-4"
          title={pick("Hızlı not", "Quick note")}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden xl:inline">
            {pick("Hızlı not", "Quick note")}
          </span>
        </Button>

        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          aria-label={pick("Klavye kısayolları", "Keyboard shortcuts")}
          title={pick("Kısayolları gör (?)", "View shortcuts (?)")}
          className={cn(
            "hidden h-9 w-9 place-items-center rounded-[10px] text-ink-3 xl:grid",
            "transition-colors duration-[120ms] hover:bg-paper-2 hover:text-ink active:bg-paper-3",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          )}
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
        </button>

        <CostChip />

        <button
          type="button"
          aria-label={pick("Bildirimler", "Notifications")}
          className={cn(
            "hidden h-9 w-9 place-items-center rounded-[10px] text-ink-3 xl:grid",
            "transition-colors duration-[120ms] hover:bg-paper-2 hover:text-ink active:bg-paper-3",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          )}
        >
          <Bell className="h-4 w-4" aria-hidden />
        </button>

        {actions}
      </header>

      {isSearchOpen ? (
        <div
          role="dialog"
          aria-label={pick("Arama", "Search")}
          aria-modal="true"
          className="fixed inset-0 z-50 flex flex-col bg-paper"
        >
          <div className="flex h-14 items-center gap-2 border-b border-rule px-3">
            <button
              type="button"
              onClick={() => setSearchOpen(false)}
              aria-label={pick("Kapat", "Close")}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-[10px] text-ink-2",
                "transition-colors hover:bg-paper-2",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              )}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
            <div className="relative flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4"
              />
              <Input
                autoFocus
                aria-label={pick("Ara", "Search")}
                placeholder={pick(
                  "Kütüphane, kaynak, alıntı ara…",
                  "Search library, sources, quotes…",
                )}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-10 w-full pl-10 text-[14px]"
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {query.length === 0 ? (
              <p className="mt-8 text-center text-[13px] text-ink-4">
                {pick("Aramaya başla…", "Start typing…")}
              </p>
            ) : (
              <p className="mt-8 text-center text-[13px] text-ink-4">
                {pick("Sonuç bulunamadı", "No results")}
              </p>
            )}
          </div>
        </div>
      ) : null}

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsHelpModal open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}

// Inline today's-cost indicator. Hidden under md so the mobile topbar stays
// compact (the bottom bar already eats half the chrome budget). Recomputes the
// midnight boundary only when the chip first mounts — refreshing once per
// session is enough; the user's day rolling over without a reload is the rare
// path and a refresh re-baselines it.
function CostChip() {
  const t = useTranslations("cost");
  const since = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const { totalUsd, loading } = useTotalCost({ since });
  const display = loading
    ? "—"
    : totalUsd === 0
      ? "$0.00"
      : totalUsd < 0.1
        ? `~$${totalUsd.toFixed(4)}`
        : `~$${totalUsd.toFixed(2)}`;
  return (
    <Link
      href="/settings#cost"
      title={t("topbar_tooltip")}
      aria-label={t("topbar_tooltip")}
      className={cn(
        "hidden items-center gap-1.5 rounded-full border border-rule-soft bg-paper-2 px-2.5 py-1 font-mono text-[11px] text-ink-3 xl:inline-flex",
        "transition-colors duration-[120ms] hover:border-ink-5 hover:text-ink",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      )}
    >
      <Receipt className="h-3 w-3" aria-hidden />
      {display}
    </Link>
  );
}
