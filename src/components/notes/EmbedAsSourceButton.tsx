"use client";

import {
  AlertCircle,
  Check,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  computeNoteHash,
  deriveButtonState,
  estimateEmbedCost,
  estimateTokenCount,
  type ButtonState,
} from "@/lib/notes/source-sync";
import {
  embedNoteAsSource,
  type EmbedderHandle,
} from "@/lib/notes/embed-as-source";
import type { EmbedderResolutionFailure } from "@/lib/notes/embedder-factory";
import { useNoteSource } from "@/lib/db/hooks";
import { cn } from "@/lib/utils/cn";

/**
 * Lazy embedder resolver shape. Returns the active `EmbedderHandle` when
 * every prerequisite is satisfied; otherwise returns `null` plus the
 * specific `reason` so the parent's toast surface can distinguish "vault
 * is locked" from "no API key for the selected preset" from the rarer
 * fallback paths. The 4-bucket reason was always available on the factory
 * (`resolveEmbedderFromPrefs(): EmbedderResolution`); 6.9 originally
 * collapsed it to a single bucket at the button seam, which sent users
 * with a locked vault to the wrong settings tab.
 */
export type EmbedderResolveResult =
  | { handle: EmbedderHandle; reason: null }
  | { handle: null; reason: EmbedderResolutionFailure };

export type EmbedAsSourceButtonProps = {
  noteId: string;
  /** Live note content — drives the hash compute that flips synced↔dirty. */
  content: string;
  /**
   * Lazily resolves the active embedder (provider + model + key). The
   * discriminator at `reason` tells the parent's toast which prerequisite
   * is missing so the user gets actionable guidance instead of a generic
   * "go set up a key" message that may not even be the real problem.
   *
   * Owning the factory at the parent keeps this component testable without
   * dragging in `useApiKeyManager` / `usePrefs` chains.
   */
  resolveEmbedder: () => Promise<EmbedderResolveResult>;
  /** Optional toast hook the parent owns. Called on success + on error. */
  onResult?: (result: {
    kind: "success" | "error" | "missing-prereq";
    reason?: EmbedderResolutionFailure;
    chunkCount?: number;
    embedsRun?: number;
    costUsd?: number;
    message?: string;
  }) => void;
  className?: string;
};

const HASH_DEBOUNCE_MS = 300;

export function EmbedAsSourceButton({
  noteId,
  content,
  resolveEmbedder,
  onResult,
  className,
}: EmbedAsSourceButtonProps) {
  const t = useTranslations("notes.embed.button");
  const tTip = useTranslations("notes.embed.tooltip");
  // Live source row. `undefined` = first paint loading; `null` = resolved
  // and no row exists; SourceRecord = row exists. The pure derivation
  // collapses (undefined|null) → idle so the user always sees the CTA on
  // first paint instead of a blank chip.
  const source = useNoteSource(noteId);
  const [currentHash, setCurrentHash] = useState<string | undefined>(undefined);
  const [transient, setTransient] = useState<"embedding" | "error" | null>(
    null,
  );
  const [lastErrorMessage, setLastErrorMessage] = useState<string | undefined>(
    undefined,
  );

  // Debounced hash recompute on content change. We don't need a fresh
  // hash on every keystroke — 300ms catches the typing pause without
  // taxing the SubtleCrypto thread. Cleared on noteId switch so a stale
  // hash never leaks across the editor remount.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      computeNoteHash(content).then((h) => {
        if (!cancelled) setCurrentHash(h);
      });
    }, HASH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [content, noteId]);

  // Reset transient state when noteId switches; otherwise the user would
  // see a leftover spinner / error from the previous note.
  useEffect(() => {
    setTransient(null);
    setLastErrorMessage(undefined);
    setCurrentHash(undefined);
  }, [noteId]);

  const state = deriveButtonState({ source, currentHash, transient });

  async function handleClick() {
    if (state === "embedding") return;
    setTransient("embedding");
    setLastErrorMessage(undefined);
    try {
      const resolution = await resolveEmbedder();
      if (!resolution.handle) {
        setTransient(null);
        // Conditional spread keeps `reason` off the result object when it's
        // null/undefined — required under `exactOptionalPropertyTypes` per
        // memory `feedback_exactoptional_fetch_signal.md`.
        onResult?.({
          kind: "missing-prereq",
          ...(resolution.reason ? { reason: resolution.reason } : {}),
        });
        return;
      }
      const result = await embedNoteAsSource(noteId, resolution.handle);
      setTransient(null);
      onResult?.({
        kind: "success",
        chunkCount: result.chunkCount,
        embedsRun: result.embedsRun,
        costUsd: result.costUsd,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTransient("error");
      setLastErrorMessage(message);
      onResult?.({ kind: "error", message });
    }
  }

  const visual = renderVisuals(state, t);
  const tooltip = renderTooltip({
    state,
    content,
    source,
    tTip,
    lastErrorMessage,
  });

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === "embedding"}
      title={tooltip}
      aria-label={visual.label}
      data-testid="note-embed-button"
      data-state={state}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 text-[12px] font-medium",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper",
        "disabled:cursor-not-allowed disabled:opacity-70",
        visual.className,
        className,
      )}
    >
      {visual.icon}
      <span>{visual.label}</span>
    </button>
  );
}

function renderVisuals(
  state: ButtonState,
  t: (key: string) => string,
): { icon: React.ReactNode; label: string; className: string } {
  switch (state) {
    case "idle":
      return {
        icon: <Sparkles className="h-3.5 w-3.5" />,
        label: t("idle"),
        className:
          "border-rule bg-paper-2/40 text-ink-2 hover:bg-paper-3 hover:text-ink active:bg-paper-4",
      };
    case "synced":
      return {
        icon: <Check className="h-3.5 w-3.5" />,
        label: t("synced"),
        className:
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15",
      };
    case "dirty":
      return {
        icon: <AlertCircle className="h-3.5 w-3.5" />,
        label: t("dirty"),
        className:
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15",
      };
    case "embedding":
      return {
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
        label: t("embedding"),
        className: "border-rule bg-paper-2/40 text-ink-2",
      };
    case "error":
      return {
        icon: <RotateCcw className="h-3.5 w-3.5" />,
        label: t("error_retry"),
        className:
          "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-500/15",
      };
  }
}

function renderTooltip(input: {
  state: ButtonState;
  content: string;
  source: ReturnType<typeof useNoteSource>;
  tTip: (key: string, values?: Record<string, string | number>) => string;
  lastErrorMessage?: string | undefined;
}): string {
  const { state, content, tTip, source, lastErrorMessage } = input;
  if (state === "error" && lastErrorMessage) return lastErrorMessage;
  if (state === "embedding") return tTip("embedding");
  if (state === "synced" && source && "lastEmbeddedAt" in source) {
    const ts = source.lastEmbeddedAt;
    if (typeof ts === "number") {
      return tTip("last_synced_at", {
        time: new Date(ts).toLocaleString(),
      });
    }
    return tTip("synced");
  }
  // idle / dirty share the same cost-preview tooltip — they both lead to
  // the same provider call. The estimate uses the public list price for
  // `text-embedding-3-small` ($0.02/1M); the actual price depends on the
  // user's selected preset and is shown again post-embed in the toast.
  const tokens = estimateTokenCount(content);
  const cost = estimateEmbedCost(content, 0.02);
  return tTip("cost_preview", {
    tokens,
    cost: cost.toFixed(4),
  });
}

// `useNoteSource`'s return type narrows after the live query resolves, so
// callers reading `.lastEmbeddedAt` need the broader type. Re-export here
// for the ref-based parent helpers in `EditorToolbar`.
export type EmbedAsSourceButtonRef = HTMLButtonElement;
// Stop tree-shake from dropping the ref import if the parent layer adds
// `forwardRef` later — keeps the surface stable across 6.9.5 additions.
void useRef;
