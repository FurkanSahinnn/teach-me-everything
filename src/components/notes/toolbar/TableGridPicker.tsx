"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";

const MAX_ROWS = 8;
const MAX_COLS = 8;

type Props = {
  onPick: (rows: number, cols: number) => void;
};

/** Word-style hover grid: highlight a rows × columns block, click to insert. */
export function TableGridPicker({ onPick }: Props) {
  const t = useTranslations("notes.editor.toolbar");
  const [hover, setHover] = useState({ rows: 2, cols: 3 });

  return (
    <div className="flex flex-col gap-2 p-1" data-testid="table-grid-picker">
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 18px)` }}
        role="grid"
        aria-label={t("table")}
      >
        {Array.from({ length: MAX_ROWS * MAX_COLS }, (_, i) => {
          const row = Math.floor(i / MAX_COLS) + 1;
          const col = (i % MAX_COLS) + 1;
          const on = row <= hover.rows && col <= hover.cols;
          return (
            <button
              key={i}
              type="button"
              aria-label={t("table_size", { rows: row, cols: col })}
              onMouseEnter={() => setHover({ rows: row, cols: col })}
              onFocus={() => setHover({ rows: row, cols: col })}
              onClick={() => onPick(row, col)}
              className={cn(
                "h-[18px] w-[18px] rounded-[3px] border transition-colors",
                on ? "border-accent bg-accent-wash" : "border-rule bg-paper-2",
              )}
            />
          );
        })}
      </div>
      <span className="text-center text-[12px] tabular-nums text-ink-3">
        {t("table_size", { rows: hover.rows, cols: hover.cols })}
      </span>
    </div>
  );
}
