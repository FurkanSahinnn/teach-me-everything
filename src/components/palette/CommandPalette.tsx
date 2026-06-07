"use client";

import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import {
  BookOpen,
  FileText,
  Highlighter,
  Layers,
  Loader2,
  type LucideIcon,
  NotebookPen,
  Search,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  searchAll,
  type SearchResult,
  type SearchResultKind,
} from "@/lib/db/fts";
import { cn } from "@/lib/utils/cn";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Grouped = Record<SearchResultKind, SearchResult[]>;

const EMPTY_GROUPS: Grouped = {
  workspace: [],
  source: [],
  note: [],
  flashcard: [],
  highlight: [],
  chunk: [],
};

const KIND_META: Record<
  SearchResultKind,
  { icon: LucideIcon; iconClass: string }
> = {
  workspace: { icon: Layers, iconClass: "text-accent" },
  source: { icon: BookOpen, iconClass: "text-ink-2" },
  note: { icon: NotebookPen, iconClass: "text-emerald-500" },
  flashcard: { icon: Sparkles, iconClass: "text-accent-hot" },
  highlight: { icon: Highlighter, iconClass: "text-amber-500" },
  chunk: { icon: FileText, iconClass: "text-ink-3" },
};

function groupResults(items: SearchResult[]): Grouped {
  const out: Grouped = {
    workspace: [],
    source: [],
    note: [],
    flashcard: [],
    highlight: [],
    chunk: [],
  };
  for (const r of items) out[r.kind].push(r);
  return out;
}

export function CommandPalette({
  open,
  onOpenChange,
}: CommandPaletteProps): React.ReactElement | null {
  const pick = useLocalePick();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset query when palette closes so the next open starts fresh.
  useEffect(() => {
    if (!open) {
      queueMicrotask(() => {
        setQuery("");
        setResults([]);
        setLoading(false);
      });
    }
  }, [open]);

  // Debounced search — 200ms after the last keystroke.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    let cancelled = false;
    if (trimmed.length === 0) {
      queueMicrotask(() => {
        if (cancelled) return;
        setResults([]);
        setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    debounceRef.current = setTimeout(() => {
      searchAll(trimmed, { limit: 30 })
        .then((items) => {
          if (!cancelled) {
            setResults(items);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
            setLoading(false);
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const grouped = useMemo<Grouped>(
    () => (results.length === 0 ? EMPTY_GROUPS : groupResults(results)),
    [results],
  );

  const groupLabels: Record<SearchResultKind, string> = {
    workspace: pick("Çalışma alanları", "Workspaces"),
    source: pick("Kaynaklar", "Sources"),
    note: pick("Notlar", "Notes"),
    flashcard: pick("Kartlar", "Flashcards"),
    highlight: pick("Alıntılar", "Highlights"),
    chunk: pick("Pasajlar", "Passages"),
  };

  if (!open) return null;

  function handleSelect(href: string): void {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={pick("Komut paleti", "Command palette")}
      shouldFilter={false}
      overlayClassName={cn(
        "fixed inset-0 z-[59] bg-ink/40 backdrop-blur-sm",
      )}
      contentClassName={cn(
        "fixed left-1/2 top-[10vh] z-[60] w-[92vw] max-w-[640px] -translate-x-1/2",
        "overflow-hidden rounded-2xl border border-rule bg-paper shadow-2xl",
      )}
    >
      {/* Radix Dialog (which cmdk uses internally) requires a DialogTitle
          for screen reader accessibility. cmdk's `label` prop only sets an
          aria-label on the inner listbox; it doesn't satisfy Radix's check.
          Render a visually-hidden Title here so the warning clears and the
          AT user gets a proper announce. */}
      <Dialog.Title className="sr-only">
        {pick("Komut paleti", "Command palette")}
      </Dialog.Title>
      <div className="flex items-center gap-2 border-b border-rule px-4">
        <Search aria-hidden className="h-4 w-4 shrink-0 text-ink-4" />
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={pick(
            "Ara: workspace, kaynak, kart, alıntı…",
            "Search: workspaces, sources, cards, highlights…",
          )}
          className={cn(
            "h-12 w-full bg-transparent text-[14px] text-ink outline-none",
            "placeholder:text-ink-4",
          )}
        />
        {loading ? (
          <Loader2
            className="h-4 w-4 shrink-0 animate-spin text-ink-3"
            aria-label={pick("Aranıyor…", "Searching…")}
          />
        ) : null}
      </div>

      <Command.List
        className={cn(
          "max-h-[60vh] overflow-y-auto px-2 py-2",
          "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5",
          "[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium",
          "[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide",
          "[&_[cmdk-group-heading]]:text-ink-4",
        )}
      >
        <Command.Empty className="px-4 py-8 text-center text-[13px] text-ink-4">
          {query.trim().length === 0
            ? pick(
                "Aramaya başla…",
                "Start typing…",
              )
            : loading
              ? pick("Aranıyor…", "Searching…")
              : pick("Sonuç yok", "No results")}
        </Command.Empty>

        {(Object.keys(grouped) as SearchResultKind[]).map((kind) => {
          const items = grouped[kind];
          if (items.length === 0) return null;
          const meta = KIND_META[kind];
          const Icon = meta.icon;
          return (
            <Command.Group
              key={kind}
              heading={groupLabels[kind]}
              className="mb-1"
            >
              {items.map((r) => (
                <Command.Item
                  key={`${r.kind}:${r.id}`}
                  value={`${r.kind}:${r.id}:${r.title}`}
                  onSelect={() => handleSelect(r.href)}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2 text-[13px]",
                    "data-[selected=true]:bg-paper-2 data-[selected=true]:text-ink",
                  )}
                >
                  <span
                    className={cn(
                      "mt-[2px] grid h-6 w-6 shrink-0 place-items-center rounded-md",
                      "bg-paper-2 ring-1 ring-rule",
                    )}
                  >
                    <Icon
                      className={cn("h-3.5 w-3.5", meta.iconClass)}
                      aria-hidden
                    />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-ink">{r.title}</span>
                    {r.snippet ? (
                      <span className="line-clamp-1 text-[12px] text-ink-3">
                        {r.snippet}
                      </span>
                    ) : r.subtitle ? (
                      <span className="truncate text-[12px] text-ink-3">
                        {r.subtitle}
                      </span>
                    ) : null}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          );
        })}
      </Command.List>
    </Command.Dialog>
  );
}
