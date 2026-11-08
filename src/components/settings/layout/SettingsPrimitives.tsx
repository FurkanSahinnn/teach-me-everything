import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type PageProps = {
  title: string;
  description?: ReactNode;
  /** Right-aligned header controls, e.g. a refresh or "restore defaults" button. */
  actions?: ReactNode;
  children: ReactNode;
};

/** One settings section page: title row plus stacked sections. */
export function SettingsPage({ title, description, actions, children }: PageProps) {
  return (
    <div className="mx-auto w-full max-w-[880px] pb-16">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-[68ch] text-[13px] leading-5 text-ink-3">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="space-y-8">{children}</div>
    </div>
  );
}

type SectionProps = {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
};

export function SettingsSection({ title, description, action, children, id }: SectionProps) {
  return (
    <section id={id} className="space-y-3">
      {title || action ? (
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
            ) : null}
            {description ? (
              <p className="mt-0.5 max-w-[68ch] text-[12.5px] leading-5 text-ink-3">{description}</p>
            ) : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

type GroupProps = { children: ReactNode; className?: string };

/** Card that stacks rows with hairline dividers. */
export function SettingsGroup({ children, className }: GroupProps) {
  return (
    <div
      className={cn(
        "divide-y divide-rule overflow-hidden rounded-[var(--radius-lg)] border border-rule bg-paper-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

type RowProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Control on the right: switch, select, input, button. */
  control?: ReactNode;
  /** Full-width content under the title row (lists, editors, help). */
  children?: ReactNode;
  /** Associates the title with a form control for accessibility. */
  htmlFor?: string;
};

export function SettingsRow({ title, description, control, children, htmlFor }: RowProps) {
  const titleNode = htmlFor ? (
    <label htmlFor={htmlFor} className="cursor-pointer">
      {title}
    </label>
  ) : (
    title
  );
  return (
    <div className="px-4 py-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium leading-5 text-ink">{titleNode}</div>
          {description ? (
            <div className="mt-0.5 max-w-[60ch] text-[12.5px] leading-5 text-ink-3">{description}</div>
          ) : null}
        </div>
        {control ? <div className="flex shrink-0 items-center gap-2 sm:justify-end">{control}</div> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
