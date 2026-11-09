"use client";

import { useTranslations } from "next-intl";
import { type CSSProperties, type MouseEvent, useMemo } from "react";
import { MarkdownPreview } from "@/components/markdown/MarkdownPreview";
import type { WikilinkClickDetail } from "@/lib/notes/live-preview";
import { parseWikilinkTarget } from "@/lib/notes/live-preview/wikilink-widget";

type Props = {
  content: string;
  width: number;
  fontSize: number;
  onWikilinkClick: (detail: WikilinkClickDetail) => void;
};

/**
 * Obsidian's reading view: the note rendered through the same markdown-it
 * pipeline as lessons (callouts, Code Styler blocks, KaTeX, coloured text),
 * centred at the editor's width so switching modes doesn't reflow the page.
 */
export function NoteReadingView({ content, width, fontSize, onWikilinkClick }: Props) {
  const t = useTranslations("notes.editor.cm_phrases");
  const labels = useMemo(
    () => ({ copy: t("Copy code"), copied: t("Copied"), collapsed: t("Collapsed code") }),
    [t],
  );

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-wikilink]");
    if (!link) return;
    event.preventDefault();
    const raw = link.getAttribute("data-wikilink") ?? "";
    const parsed = parseWikilinkTarget(raw);
    onWikilinkClick({ raw, target: parsed.target, kind: parsed.kind, alias: parsed.alias });
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto" data-testid="note-reading-view" onClickCapture={handleClick}>
      <div
        className="mx-auto px-10 pb-[30vh] pt-7"
        style={{ maxWidth: width, fontSize } as CSSProperties}
      >
        <MarkdownPreview text={content} labels={labels} className="tme-reading" />
      </div>
    </div>
  );
}
