"use client";

import { ExternalLink, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useLocalePick } from "@/i18n/IntlProvider";
import type { WebCitation } from "@/lib/ai/web-search/types";
import {
  citationDomainLabel,
  googleFaviconUrl,
} from "./WebCitationChip";

type IngestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; sourceId: string }
  | { kind: "error"; message: string };

type Props = {
  open: boolean;
  citation: WebCitation | null;
  onClose: () => void;
  /**
   * Wired to `ingestResearchUrl({ workspaceId, rawInput: citation.result.url })`
   * by the parent. Kept as an injection point so the modal stays pure-UI and
   * test-friendly — no Dexie / network surface in this file.
   *
   * Resolves to the created `sourceId` so the modal can flip to a "done"
   * state and the caller can navigate / toast as it sees fit.
   */
  onMakeSource: (citation: WebCitation) => Promise<string>;
  /**
   * Optional — when omitted, "Make a source" button is hidden (e.g. when the
   * reader is rendered outside a workspace and ingestion isn't applicable).
   */
  enableMakeSource?: boolean;
};

function formatPublishedDate(raw: string | undefined, locale: "tr" | "en"): string | null {
  if (!raw) return null;
  // ISO-8601 happy path; falls back to the raw string if parsing fails so
  // adapter quirks (e.g. "May 11, 2026") never produce "Invalid Date".
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  try {
    return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return raw;
  }
}

export function WebCitationPeekModal({
  open,
  citation,
  onClose,
  onMakeSource,
  enableMakeSource = true,
}: Props) {
  const pick = useLocalePick();
  const [state, setState] = useState<IngestState>({ kind: "idle" });

  const result = citation?.result ?? null;
  const domain = result ? citationDomainLabel(result.url) : "";
  const favicon = result
    ? (result.faviconUrl ?? googleFaviconUrl(result.url))
    : null;
  const publishedLabel = result
    ? formatPublishedDate(result.publishedAt, pick("tr", "en") as "tr" | "en")
    : null;

  function handleClose(): void {
    if (state.kind === "running") return;
    setState({ kind: "idle" });
    onClose();
  }

  async function handleMakeSource(): Promise<void> {
    if (!citation || state.kind === "running") return;
    setState({ kind: "running" });
    try {
      const sourceId = await onMakeSource(citation);
      setState({ kind: "done", sourceId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: "error", message });
    }
  }

  function handleOpenExternal(): void {
    if (!result) return;
    // `noopener noreferrer` keeps the referrer policy strict; `noreferrer`
    // doubles as a privacy guard for users worried about reverse-search
    // attribution.
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  if (!citation || !result) {
    return (
      <Modal
        open={open}
        onClose={handleClose}
        title={pick("Kaynak yok", "No citation")}
        size="sm"
      />
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="md"
      title={
        <div className="flex items-start gap-2.5">
          {favicon ? (
            <img
              src={favicon}
              alt=""
              aria-hidden
              width={20}
              height={20}
              className="mt-0.5 h-5 w-5 rounded-[3px]"
            />
          ) : null}
          <span className="font-serif text-[16px] font-medium leading-tight text-ink">
            {result.title || domain}
          </span>
        </div>
      }
      description={
        <span className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
          <span className="font-mono">{domain}</span>
          {publishedLabel ? (
            <>
              <span aria-hidden>·</span>
              <span>{publishedLabel}</span>
            </>
          ) : null}
          {result.provider ? (
            <>
              <span aria-hidden>·</span>
              <span className="rounded-[6px] border border-rule-soft bg-paper-2 px-1.5 py-0.5 text-[10.5px] uppercase tracking-[0.04em]">
                {result.provider}
              </span>
            </>
          ) : null}
        </span>
      }
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenExternal}
            disabled={state.kind === "running"}
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            <span>{pick("Tarayıcıda aç", "Open in browser")}</span>
          </Button>
          {enableMakeSource ? (
            <Button
              variant="primary"
              size="sm"
              onClick={handleMakeSource}
              loading={state.kind === "running"}
              disabled={state.kind === "done" || state.kind === "running"}
              data-testid="web-citation-make-source"
            >
              {state.kind === "running" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-4 w-4" aria-hidden />
              )}
              <span>
                {state.kind === "done"
                  ? pick("Eklendi", "Added")
                  : pick("Kaynak yap", "Make a source")}
              </span>
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-3 text-[13px] leading-relaxed text-ink-2">
        <p className="whitespace-pre-wrap">{result.snippet}</p>
        {state.kind === "error" ? (
          <p
            role="alert"
            className="rounded-[8px] border border-err/30 bg-err/5 px-3 py-2 text-[12px] text-err"
          >
            {pick("Eklenemedi:", "Failed to add:")} {state.message}
          </p>
        ) : null}
        {state.kind === "done" ? (
          <p
            role="status"
            className="rounded-[8px] border border-ok/30 bg-ok/5 px-3 py-2 text-[12px] text-ok"
          >
            {pick("Kaynak eklendi.", "Source added.")}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
