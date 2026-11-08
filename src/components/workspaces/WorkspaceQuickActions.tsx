"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { BookOpen, Layers, Map, SquareStack } from "@/components/icons";
import type { QuizResultSummary } from "@/lib/db/quiz-sessions";

export type WorkspaceQuickStats = {
  flashcardCount: number;
  dueFlashcardCount: number;
  lastQuiz: QuizResultSummary | null;
  conceptCount: number;
  conceptEdgeCount: number;
};

type Props = {
  workspaceId: string;
  firstSourceHref: string;
  stats: WorkspaceQuickStats;
};

export function WorkspaceQuickActions({ workspaceId, firstSourceHref, stats }: Props) {
  const t = useTranslations("workspace");

  const cardsSubtitle =
    stats.flashcardCount === 0
      ? t("quick_cards_none")
      : stats.dueFlashcardCount === 0
        ? t("quick_cards_none_due")
        : t("quick_cards_due", { count: stats.dueFlashcardCount });

  const quizSubtitle = stats.lastQuiz
    ? t("quick_quiz_last", { correct: stats.lastQuiz.correct, total: stats.lastQuiz.total })
    : t("quick_quiz_none");

  const mapSubtitle =
    stats.conceptCount === 0
      ? t("quick_map_none")
      : t("quick_map_counts", { concepts: stats.conceptCount, links: stats.conceptEdgeCount });

  return (
    <section className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <QuickAction
        href={firstSourceHref}
        icon={BookOpen}
        title={t("okumaya_basla")}
        subtitle={t("quick_read_resume")}
      />
      <QuickAction
        href={`/w/${workspaceId}/cards`}
        icon={Layers}
        title={t("kart_tekrari")}
        subtitle={cardsSubtitle}
      />
      <QuickAction
        href={`/w/${workspaceId}/quiz`}
        icon={SquareStack}
        title={t("quiz_baslat")}
        subtitle={quizSubtitle}
      />
      <QuickAction
        href={`/w/${workspaceId}/map`}
        icon={Map}
        title={t("zihin_haritasi")}
        subtitle={mapSubtitle}
      />
    </section>
  );
}

type QuickActionProps = {
  href: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
};

function QuickAction({ href, icon: Icon, title, subtitle }: QuickActionProps) {
  return (
    <Link
      href={href}
      className="group rounded-[var(--radius-lg)] border border-rule bg-paper-2 p-4 shadow-[var(--shadow-soft)] transition-[background,border-color,transform] duration-[160ms] hover:-translate-y-[1px] hover:border-rule-strong hover:bg-paper-3"
    >
      <Icon className="h-4 w-4 text-accent" aria-hidden />
      <div className="mt-4 text-[14px] font-semibold text-ink">{title}</div>
      <div className="mt-1 text-[12.5px] leading-5 text-ink-3">{subtitle}</div>
    </Link>
  );
}
