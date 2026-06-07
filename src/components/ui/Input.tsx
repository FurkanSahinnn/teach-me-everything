import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  variant?: "default" | "mono";
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, variant = "default", invalid = false, type = "text", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full rounded-[10px] border bg-paper px-3 py-[9px] text-[14px] text-ink placeholder:text-ink-4",
        "transition-[border-color,box-shadow,background-color] duration-[120ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
        "focus:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-paper-2",
        invalid
          ? "border-err focus-visible:border-err focus-visible:ring-2 focus-visible:ring-err/30"
          : "border-rule hover:border-rule-strong focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25",
        variant === "mono" && "font-mono text-[13px]",
        className,
      )}
      {...rest}
    />
  );
});
