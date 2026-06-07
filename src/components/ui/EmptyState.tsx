import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

export type EmptyStateAction = {
  label: string;
  onClick?: () => void;
  href?: string;
};

export type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  description: string;
  action?: EmptyStateAction;
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[480px] flex-col items-center justify-center text-center",
        "py-8 sm:py-12",
        className,
      )}
    >
      <div className="text-ink-3 [&>svg]:h-12 [&>svg]:w-12" aria-hidden>
        {icon}
      </div>
      <h3 className="mt-4 font-serif text-[18px] font-medium leading-tight text-ink">
        {title}
      </h3>
      <p className="mt-2 max-w-[420px] text-[13px] leading-6 text-ink-3">
        {description}
      </p>
      {action ? (
        <div className="mt-5">
          {action.href ? (
            <Link href={action.href}>
              <Button variant="primary" size="sm">
                {action.label}
              </Button>
            </Link>
          ) : (
            <Button variant="primary" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
