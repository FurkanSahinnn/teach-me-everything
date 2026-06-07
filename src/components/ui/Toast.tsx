"use client";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils/cn";

export type ToastVariant = "info" | "success" | "warn" | "error";

export type ToastInput = {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  action?: { label: string; onClick: () => void };
};

type ToastRecord = {
  id: string;
  title?: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
  action?: { label: string; onClick: () => void };
  createdAt: number;
};

type ToastContextValue = {
  toasts: ReadonlyArray<ToastRecord>;
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_ICON: Record<ToastVariant, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: AlertCircle,
};

const VARIANT_BORDER: Record<ToastVariant, string> = {
  info: "border-rule",
  success: "border-ok/45",
  warn: "border-warn/45",
  error: "border-err/45",
};

const VARIANT_ICON_TONE: Record<ToastVariant, string> = {
  info: "text-ink-3",
  success: "text-ok",
  warn: "text-warn",
  error: "text-err",
};

let counter = 0;
function nextId(): string {
  counter += 1;
  return `t_${Date.now().toString(36)}_${counter}`;
}

const DEFAULT_DURATION = 5000;
const STICKY_DURATIONS = new Set<ToastVariant>(["error"]);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (input: ToastInput): string => {
      const id = nextId();
      const variant: ToastVariant = input.variant ?? "info";
      const duration =
        input.duration ?? (STICKY_DURATIONS.has(variant) ? 8000 : DEFAULT_DURATION);
      const record: ToastRecord = {
        id,
        variant,
        duration,
        createdAt: Date.now(),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.action ? { action: input.action } : {}),
      };
      setToasts((prev) => [...prev, record]);
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  const clear = useCallback((): void => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current.clear();
    setToasts([]);
  }, []);

  useEffect(() => {
    const map = timersRef;
    return () => {
      map.current.forEach((t) => clearTimeout(t));
      map.current.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, toast, dismiss, clear }),
    [toasts, toast, dismiss, clear],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ReadonlyArray<ToastRecord>;
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      role="region"
      aria-label="Notifications"
      className={cn(
        "pointer-events-none fixed z-[120] flex flex-col gap-2",
        "bottom-[calc(env(safe-area-inset-bottom)+88px)] left-1/2 w-[calc(100%-2rem)] max-w-[360px] -translate-x-1/2",
        "sm:bottom-4 sm:right-4 sm:left-auto sm:translate-x-0",
      )}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} record={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  record,
  onDismiss,
}: {
  record: ToastRecord;
  onDismiss: (id: string) => void;
}) {
  const [entered, setEntered] = useState(false);
  const Icon = VARIANT_ICON[record.variant];
  const isAlert = record.variant === "error" || record.variant === "warn";

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      role={isAlert ? "alert" : "status"}
      aria-live={isAlert ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-[var(--radius)] border bg-paper p-3 shadow-[var(--shadow-medium)]",
        "transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.2,0.6,0.2,1)]",
        entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
        VARIANT_BORDER[record.variant],
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-[1px] h-4 w-4 shrink-0",
          VARIANT_ICON_TONE[record.variant],
        )}
      />
      <div className="min-w-0 flex-1">
        {record.title && (
          <p className="text-[13.5px] font-medium leading-tight text-ink">
            {record.title}
          </p>
        )}
        {record.description && (
          <p
            className={cn(
              "text-[12.5px] leading-snug text-ink-3",
              record.title && "mt-0.5",
            )}
          >
            {record.description}
          </p>
        )}
        {record.action && (
          <button
            type="button"
            onClick={() => {
              record.action!.onClick();
              onDismiss(record.id);
            }}
            className={cn(
              "mt-1.5 text-[12.5px] font-medium text-accent",
              "hover:text-accent-hot focus:outline-none focus-visible:underline",
            )}
          >
            {record.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(record.id)}
        aria-label="Dismiss notification"
        className={cn(
          "-m-1 grid h-7 w-7 place-items-center rounded-[8px] text-ink-4",
          "transition-[background,color] duration-[120ms]",
          "hover:bg-paper-2 hover:text-ink",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        )}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
