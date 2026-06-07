"use client";

import { ArrowRight, FolderPlus, PlayCircle, Settings } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { markSetupComplete } from "@/lib/setup-completion";

export function DoneStep() {
  const t = useTranslations("setup");
  const ts = useTranslations("setup.done");

  const actions: {
    href: string;
    label: string;
    icon: typeof FolderPlus;
  }[] = [
    { href: "/dashboard?new=workspace", label: ts("action_workspace"), icon: FolderPlus },
    { href: "/settings", label: ts("action_settings"), icon: Settings },
    { href: "/dashboard", label: ts("action_demo"), icon: PlayCircle },
  ];

  return (
    <section>
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        {t("44_ilk_workspace")}
      </div>
      <h1 className="mt-2 font-serif text-[40px] font-normal leading-[1.1] tracking-[-0.02em]">
        {ts("title")}
      </h1>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-[1.6] text-ink-3">
        {ts("subtitle")}
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Link
              key={a.href}
              href={a.href}
              onClick={markSetupComplete}
              className="block"
            >
              <Card padding="lg" interactive className="h-full">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-[10px] border border-rule-soft bg-paper-2 text-accent-ink">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <ArrowRight
                    className="h-4 w-4 text-ink-4"
                    aria-hidden
                  />
                </div>
                <div className="mt-4 font-serif text-[15px] font-medium text-ink">
                  {a.label}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
