import { cn } from "@/lib/utils/cn";

type BrandProps = {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  className?: string;
};

const SIZES = {
  sm: { mark: "h-5 w-5", text: "text-[15px]", glyph: "text-[11px]" },
  md: { mark: "h-[22px] w-[22px]", text: "text-[18px]", glyph: "text-[13px]" },
  lg: { mark: "h-7 w-7", text: "text-2xl", glyph: "text-base" },
} as const;

export function Brand({
  size = "md",
  showWordmark = true,
  className,
}: BrandProps) {
  const s = SIZES[size];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-serif font-medium tracking-[-0.01em] text-ink",
        className,
      )}
    >
      <span
        className={cn(
          "relative inline-grid place-items-center rounded-full border border-ink bg-paper font-serif italic text-ink",
          s.mark,
          s.glyph,
        )}
        aria-hidden
      >
        <span className="relative z-10">T</span>
        <span className="pointer-events-none absolute inset-[3px] rounded-full border border-rule" />
      </span>
      {showWordmark ? (
        <span className={cn("leading-none", s.text)}>Teach Me Everything</span>
      ) : null}
    </span>
  );
}
