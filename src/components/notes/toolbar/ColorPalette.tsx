"use client";

import { useTranslations } from "next-intl";
import { Ban, Check } from "@/components/icons";
import { cn } from "@/lib/utils/cn";

type Props = {
  /** Palette slots from preferences. */
  colors: readonly string[];
  recent: readonly string[];
  /** Colour currently applied to the selection, if any. */
  active: string | null;
  /** Text palettes show an "A" swatch; background palettes show filled chips. */
  variant: "text" | "background";
  onPick: (color: string) => void;
  onRemove: () => void;
};

function Swatch({
  color,
  variant,
  selected,
  onPick,
}: {
  color: string;
  variant: Props["variant"];
  selected: boolean;
  onPick: (color: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(color)}
      title={color}
      aria-label={color}
      aria-pressed={selected}
      className={cn(
        "relative grid h-7 w-7 place-items-center rounded-[6px] border text-[13px] font-semibold transition-transform hover:scale-110",
        selected ? "border-ink" : "border-rule",
      )}
      style={variant === "background" ? { backgroundColor: color } : { color }}
    >
      {variant === "text" ? "A" : null}
      {selected ? (
        <Check className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-ink p-px text-paper" aria-hidden />
      ) : null}
    </button>
  );
}

/**
 * Colour picker shared by the text-colour and highlight-colour menus: palette
 * slots, recently used custom colours, a native colour input and "remove".
 */
export function ColorPalette({ colors, recent, active, variant, onPick, onRemove }: Props) {
  const t = useTranslations("notes.editor.toolbar");
  const activeLower = active?.toLowerCase() ?? null;
  // The native input only understands #rrggbb; background slots carry alpha.
  const seed = (activeLower ?? colors[0] ?? "#000000").slice(0, 7);

  return (
    <div className="flex w-[232px] flex-col gap-2 p-1" data-testid={`color-palette-${variant}`}>
      <div className="grid grid-cols-7 gap-1.5">
        {colors.map((c) => (
          <Swatch key={c} color={c} variant={variant} selected={c === activeLower} onPick={onPick} />
        ))}
      </div>
      {recent.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-4">
            {t("recent_colors")}
          </span>
          <div className="grid grid-cols-7 gap-1.5">
            {recent.map((c) => (
              <Swatch key={c} color={c} variant={variant} selected={c === activeLower} onPick={onPick} />
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex items-center gap-1.5 border-t border-rule-soft pt-2">
        <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-[6px] px-1.5 py-1 text-[12.5px] text-ink-2 hover:bg-paper-2">
          <input
            type="color"
            defaultValue={seed}
            onChange={(e) => {
              const hex = e.target.value;
              onPick(variant === "background" ? `${hex}59` : hex);
            }}
            className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
            aria-label={t("custom_color")}
          />
          {t("custom_color")}
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12.5px] text-ink-3 hover:bg-paper-2 hover:text-ink"
        >
          <Ban className="h-3.5 w-3.5" aria-hidden />
          {t("remove_color")}
        </button>
      </div>
    </div>
  );
}
