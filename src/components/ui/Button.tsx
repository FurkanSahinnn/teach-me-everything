import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export type ButtonVariant =
  | "default"
  | "primary"
  | "accent"
  | "ghost"
  | "danger";

export type ButtonSize =
  | "sm"
  | "md"
  | "lg"
  | "icon-sm"
  | "icon-md"
  | "icon-lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

const VARIANT: Record<ButtonVariant, string> = {
  default: cn(
    "bg-paper-3 text-ink border-rule-strong shadow-[var(--shadow-medium)]",
    "hover:bg-paper-4 hover:border-accent hover:text-ink",
    "active:bg-paper-4",
  ),
  primary: cn(
    "bg-accent-hot text-white border-accent shadow-[var(--shadow-medium)]",
    "hover:bg-accent hover:border-accent-ink",
    "active:bg-accent-ink",
  ),
  accent: cn(
    "bg-accent-hot text-white border-accent-ink shadow-[var(--shadow-medium)]",
    "hover:bg-accent hover:border-accent-ink",
    "active:bg-accent-ink active:border-accent-ink",
  ),
  ghost: cn(
    "bg-paper-2 text-ink border-rule-strong shadow-[var(--shadow-soft)]",
    "hover:bg-paper-3 hover:border-accent hover:text-ink",
    "active:bg-paper-3",
  ),
  danger: cn(
    "bg-err text-paper border-err shadow-[var(--shadow-medium)]",
    "hover:bg-err/90 hover:border-err",
    "active:bg-err",
  ),
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-4 py-2 text-[13px] gap-2 rounded-[10px]",
  md: "h-11 px-5 py-2.5 text-[14px] gap-2.5 rounded-[10px]",
  lg: "h-14 px-7 py-3 text-[15px] gap-3 rounded-[12px]",
  "icon-sm": "h-9 w-9 rounded-[10px]",
  "icon-md": "h-11 w-11 rounded-[10px]",
  "icon-lg": "h-14 w-14 rounded-[12px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant = "default",
      size = "md",
      loading = false,
      disabled,
      type = "button",
      children,
      ...rest
    },
    ref,
  ) {
    const isDisabled = disabled || loading;
    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={cn(
          "relative inline-flex items-center justify-center border font-semibold select-none",
          "transition-[background,color,border,box-shadow,transform] duration-[120ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          "hover:-translate-y-[1px] hover:shadow-[var(--shadow-lift)]",
          "active:translate-y-0",
          "disabled:cursor-not-allowed disabled:opacity-75 disabled:hover:translate-y-0 disabled:hover:shadow-[var(--shadow-soft)]",
          VARIANT[variant],
          SIZE[size],
          className,
        )}
        {...rest}
      >
        {loading ? (
          <span className="absolute inset-0 grid place-items-center" aria-hidden>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          </span>
        ) : null}
        <span
          className={cn(
            "inline-flex items-center justify-center gap-[inherit]",
            loading && "invisible",
          )}
        >
          {children}
        </span>
      </button>
    );
  },
);
