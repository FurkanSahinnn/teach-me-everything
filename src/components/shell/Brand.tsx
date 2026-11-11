import { cn } from "@/lib/utils/cn";

type BrandProps = {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  className?: string;
};

const SIZES = {
  sm: { mark: "h-6 w-6", text: "text-[15px]" },
  md: { mark: "h-7 w-7", text: "text-[18px]" },
  lg: { mark: "h-9 w-9", text: "text-2xl" },
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
        "inline-flex items-center gap-2.5 font-serif font-medium tracking-[-0.01em] text-ink",
        className,
      )}
    >
      <span
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center rounded-[8px] border border-accent-soft bg-paper-2 shadow-[var(--shadow-soft)]",
          s.mark,
        )}
        aria-hidden
      >
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-[82%] w-[82%]"
        >
          {/* Subtle inner glow / wash */}
          <circle
            cx="16"
            cy="14"
            r="10"
            fill="var(--color-accent-wash)"
            opacity="0.75"
          />

          {/* Open book / layered manuscript wings */}
          <path
            d="M5.5 22.5C8.5 21 12.2 21.4 16 23.8C19.8 21.4 23.5 21 26.5 22.5"
            stroke="var(--color-ink-3)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4.5 19C8 17.2 12.2 17.8 16 20.6C19.8 17.8 24 17.2 27.5 19V10.5C24 8.8 19.8 9.4 16 12.2C12.2 9.4 8 8.8 4.5 10.5V19Z"
            fill="var(--color-paper)"
            stroke="var(--color-ink)"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />

          {/* Central spine + Knowledge Tree / T-axis */}
          <path
            d="M16 20.6V8.5"
            stroke="var(--color-accent)"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* Constellation branches forming a subtle 'T' canopy over the open pages */}
          <path
            d="M9.5 11.5L16 8.5L22.5 11.5"
            stroke="var(--color-accent)"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Knowledge nodes */}
          <circle cx="9.5" cy="11.5" r="1.75" fill="var(--color-accent)" />
          <circle cx="22.5" cy="11.5" r="1.75" fill="var(--color-accent)" />

          {/* Apex spark / star of synthesis */}
          <path
            d="M16 3.2L17.1 5.9L19.8 7L17.1 8.1L16 10.8L14.9 8.1L12.2 7L14.9 5.9L16 3.2Z"
            fill="var(--color-accent-hot)"
          />
        </svg>
      </span>
      {showWordmark ? (
        <span className={cn("leading-none", s.text)}>Teach Me Everything</span>
      ) : null}
    </span>
  );
}
