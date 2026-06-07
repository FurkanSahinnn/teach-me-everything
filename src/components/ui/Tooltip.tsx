"use client";

import {
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils/cn";

export type TooltipSide = "top" | "bottom" | "left" | "right";

type TriggerProps = {
  "aria-describedby"?: string | undefined;
  onMouseEnter?: ((event: MouseEvent) => void) | undefined;
  onMouseLeave?: ((event: MouseEvent) => void) | undefined;
  onFocus?: ((event: FocusEvent) => void) | undefined;
  onBlur?: ((event: FocusEvent) => void) | undefined;
};

type TooltipProps = {
  content: ReactNode;
  side?: TooltipSide;
  delay?: number;
  hideOnMobile?: boolean;
  className?: string;
  children: ReactElement<TriggerProps>;
};

const SIDE_POS: Record<TooltipSide, string> = {
  top: "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-1.5 -translate-x-1/2",
  left: "right-full top-1/2 mr-1.5 -translate-y-1/2",
  right: "left-full top-1/2 ml-1.5 -translate-y-1/2",
};

export function Tooltip({
  content,
  side = "top",
  delay = 300,
  hideOnMobile = true,
  className,
  children,
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function show(): void {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), delay);
  }

  function hide(): void {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  }

  if (!isValidElement(children)) {
    return <>{children}</>;
  }

  const childProps: TriggerProps = children.props;

  return (
    <span
      className="relative inline-flex"
      {...(open ? { "aria-describedby": id } : {})}
      onMouseEnter={(event: MouseEvent) => {
        childProps.onMouseEnter?.(event);
        show();
      }}
      onMouseLeave={(event: MouseEvent) => {
        childProps.onMouseLeave?.(event);
        hide();
      }}
      onFocus={(event: FocusEvent) => {
        childProps.onFocus?.(event);
        show();
      }}
      onBlur={(event: FocusEvent) => {
        childProps.onBlur?.(event);
        hide();
      }}
    >
      {children}
      <span
        role="tooltip"
        id={id}
        aria-hidden={!open}
        className={cn(
          "pointer-events-none absolute z-[110] whitespace-nowrap",
          "rounded-[8px] border border-rule-strong bg-ink px-2 py-1",
          "text-[11.5px] font-medium text-paper shadow-[var(--shadow-medium)]",
          "transition-[opacity,transform] duration-[120ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
          open ? "opacity-100 scale-100" : "opacity-0 scale-95",
          hideOnMobile && "hidden md:inline-block",
          SIDE_POS[side],
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
