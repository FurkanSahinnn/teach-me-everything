"use client";

import { ArrowRight, BookOpen, Lock, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type Props = {
  onContinue: () => void;
};

export function WelcomeStep({ onContinue }: Props) {
  const t = useTranslations("setup");
  const ts = useTranslations("setup.welcome");

  const bullets = [
    { icon: Sparkles, text: ts("bullet1") },
    { icon: BookOpen, text: ts("bullet2") },
    { icon: Lock, text: ts("bullet3") },
  ];

  return (
    <section>
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        {t("14_hos_geldiniz")}
      </div>
      <h1 className="mt-2 font-serif text-[40px] font-normal leading-[1.1] tracking-[-0.02em]">
        {ts("title")}
      </h1>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-[1.6] text-ink-3">
        {ts("subtitle")}
      </p>

      <Card padding="lg" className="mt-6">
        <ul className="space-y-3">
          {bullets.map((b, i) => {
            const Icon = b.icon;
            return (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] border border-rule-soft bg-paper-2 text-accent-ink">
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <p className="text-[14px] leading-[1.55] text-ink-2">
                  {b.text}
                </p>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="mt-6 flex">
        <Button variant="primary" size="lg" onClick={onContinue}>
          {ts("cta")}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </section>
  );
}
