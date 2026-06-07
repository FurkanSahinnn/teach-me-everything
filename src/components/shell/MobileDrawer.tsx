"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type MobileDrawerProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function MobileDrawer({ open, onClose, children }: MobileDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <div
      className={cn("fixed inset-0 z-50 md:hidden", !open && "pointer-events-none")}
      aria-hidden={!open}
      // `inert` when closed removes the off-screen overlay + nav links from
      // the tab order and pointer/SR layers — `pointer-events-none` +
      // `aria-hidden` alone still let keyboard Tab land on hidden controls.
      inert={!open}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close menu"
        tabIndex={open ? 0 : -1}
        className={cn(
          "absolute inset-0 bg-ink/40 backdrop-blur-sm transition-opacity duration-[200ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={cn(
          "absolute left-0 top-0 flex h-full w-[85%] max-w-[320px] flex-col",
          "transition-transform duration-[240ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {children}
      </aside>
    </div>
  );
}
