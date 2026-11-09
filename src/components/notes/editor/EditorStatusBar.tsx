"use client";

import { useTranslations } from "next-intl";
import { MoveHorizontal } from "@/components/icons";
import { percentFromWidth, widthFromPercent } from "@/lib/notes/editor-prefs";
import { cn } from "@/lib/utils/cn";

export type SaveState = "idle" | "dirty" | "saving" | "saved";

type Props = {
  words: number;
  characters: number;
  saveState: SaveState;
  /** Global width preference (px). */
  width: number;
  /** Width forced by the note's `editor-width` frontmatter, if any. */
  noteWidth: number | null;
  onWidthChange: (px: number) => void;
  onWidthReset: () => void;
};

const WORDS_PER_MINUTE = 200;

/**
 * Status bar under the editor: counts, reading time, save state and the
 * Editor Width Slider (0–100 mapped onto the readable-width range). Clicking
 * the percentage resets to the default, like the Obsidian plugin's badge.
 */
export function EditorStatusBar({
  words,
  characters,
  saveState,
  width,
  noteWidth,
  onWidthChange,
  onWidthReset,
}: Props) {
  const t = useTranslations("notes.editor.footer");
  const effective = noteWidth ?? width;
  const pct = percentFromWidth(effective);
  const minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-4 border-t border-rule px-4 text-[11.5px] text-ink-4"
      data-testid="note-editor-statusbar"
    >
      <span data-testid="note-editor-word-count" className="tabular-nums">
        {words === 0 ? t("word_count_zero") : words === 1 ? t("word_count_one") : t("word_count_many", { count: words })}
      </span>
      <span className="hidden tabular-nums sm:inline">{t("char_count", { count: characters })}</span>
      {words > 0 ? <span className="hidden tabular-nums md:inline">{t("reading_time", { minutes })}</span> : null}

      <span className="ml-auto inline-flex items-center gap-1.5" aria-live="polite">
        {saveState === "idle" ? null : (
          <span
            data-testid="note-editor-save-state"
            data-state={saveState}
            className={cn("inline-flex items-center gap-1.5", saveState === "saved" ? "text-ok" : "text-ink-3")}
          >
            <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", saveState === "saved" ? "bg-ok" : "bg-accent")} />
            {saveState === "saved" ? t("saved") : t("saving")}
          </span>
        )}
      </span>

      <label
        className="hidden items-center gap-2 md:inline-flex"
        title={noteWidth !== null ? t("width_note_override") : t("width_label")}
      >
        <MoveHorizontal className="h-3.5 w-3.5" aria-hidden />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          disabled={noteWidth !== null}
          onChange={(e) => onWidthChange(widthFromPercent(Number(e.target.value)))}
          aria-label={t("width_label")}
          aria-valuetext={`${effective}px`}
          data-testid="note-editor-width-slider"
          className="h-1 w-24 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
        />
      </label>
      <button
        type="button"
        onClick={onWidthReset}
        disabled={noteWidth !== null}
        title={t("width_reset")}
        className="hidden w-9 rounded px-1 text-right tabular-nums hover:bg-paper-3 hover:text-ink disabled:pointer-events-none md:inline"
      >
        {pct}%
      </button>
    </div>
  );
}
