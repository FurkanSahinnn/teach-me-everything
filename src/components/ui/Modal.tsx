"use client";

import { X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  hideClose?: boolean;
  ariaLabel?: string;
  closeLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  bodyClassName?: string;
};

const SIZE: Record<ModalSize, string> = {
  sm: "max-w-[380px]",
  md: "max-w-[480px]",
  lg: "max-w-[640px]",
  xl: "max-w-[820px]",
  full: "max-w-[min(100%-1rem,1100px)]",
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) =>
      !el.hasAttribute("aria-hidden") &&
      el.offsetParent !== null,
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
  closeOnEsc = true,
  hideClose = false,
  ariaLabel,
  closeLabel = "Close",
  initialFocusRef,
  className,
  bodyClassName,
}: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);
  const [entered, setEntered] = useState(false);

  // Callers commonly pass inline arrow functions for onClose, which produces
  // a new reference on every parent render. Keeping these in the useEffect
  // deps would tear down + re-arm the entire focus/keyboard/scroll-lock
  // setup on every keystroke inside the modal, causing focus to jump to the
  // first focusable element (the close X) and blocking input typing.
  // Stabilise via refs so the effect only re-runs when `open` actually changes.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeOnEscRef = useRef(closeOnEsc);
  closeOnEscRef.current = closeOnEsc;
  const initialFocusRefRef = useRef(initialFocusRef);
  initialFocusRefRef.current = initialFocusRef;

  useEffect(() => {
    if (!open) {
      queueMicrotask(() => setEntered(false));
      return;
    }

    previouslyFocusedRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const enterFrame = requestAnimationFrame(() => setEntered(true));

    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape" && closeOnEscRef.current) {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") {
        const root = dialogRef.current;
        if (!root) return;
        const focusables = getFocusable(root);
        if (focusables.length === 0) {
          event.preventDefault();
          root.focus();
          return;
        }
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (event.shiftKey && (active === first || !root.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (active === last || !root.contains(active))
        ) {
          // Mirror the shift-branch guard: also pull focus back to `first`
          // when it has escaped the dialog entirely, not only when it sits on
          // the last focusable.
          event.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", onKey);

    const focusFrame = requestAnimationFrame(() => {
      const target =
        initialFocusRefRef.current?.current ??
        (dialogRef.current
          ? getFocusable(dialogRef.current)[0] ?? dialogRef.current
          : null);
      target?.focus();
    });

    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(enterFrame);
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = prevOverflow;
      const last = previouslyFocusedRef.current;
      if (last instanceof HTMLElement) last.focus();
    };
  }, [open]);

  if (!open) return null;

  function onBackdropMouseDown(event: MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget && closeOnBackdrop) onClose();
  }

  const node = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={onBackdropMouseDown}
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 bg-ink/45 backdrop-blur-[2px]",
          "transition-opacity duration-[160ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
          entered ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        aria-label={!title && ariaLabel ? ariaLabel : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex w-full max-h-[calc(100dvh-2rem)] flex-col",
          "rounded-[var(--radius-lg)] border border-rule bg-paper shadow-[var(--shadow-deep)]",
          "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          "transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
          entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
          SIZE[size],
          className,
        )}
      >
        {(title || !hideClose) && (
          <header className="flex items-start justify-between gap-3 border-b border-rule-soft px-5 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              {title && (
                <h2
                  id={titleId}
                  className="font-serif text-[18px] font-medium leading-tight text-ink"
                >
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="mt-1 text-[13px] text-ink-3">
                  {description}
                </p>
              )}
            </div>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                className={cn(
                  "-m-1 grid h-8 w-8 place-items-center rounded-[8px] text-ink-3",
                  "transition-[background,color] duration-[120ms]",
                  "hover:bg-paper-2 hover:text-ink",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                )}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </header>
        )}
        <div
          className={cn(
            "flex-1 overflow-auto px-5 py-4 text-[14px] text-ink",
            bodyClassName,
          )}
        >
          {children}
        </div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-rule-soft bg-paper-2 px-5 py-3 rounded-b-[var(--radius-lg)]">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
