"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Clock3,
  Layers,
  MessageCircle,
  Pencil,
  Plus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import {
  DeleteWorkspaceDialog,
  WorkspaceCard,
} from "@/components/workspaces/WorkspaceCard";
import { WorkspaceFormModal } from "@/components/workspaces/WorkspaceFormModal";
// STREAK_30_DAYS was retired in Phase 4.A — heatmap is now derived live from
// `useDashboardStats().streakHeatmap` (see hooks.ts).
import {
  useDashboardActivity,
  useDashboardStats,
  useWorkspaces,
} from "@/lib/db/hooks";
import type { WorkspaceRecord } from "@/lib/db/types";
import { useLocalePick } from "@/i18n/IntlProvider";
import { cn } from "@/lib/utils/cn";
import { formatFullDate } from "@/lib/utils/intl";
import { usePrefs } from "@/stores/prefs";
import { useTranslations } from "next-intl";
import { useCurrentTime } from "@/hooks/useCurrentTime";
import type {
  ActivityItemKind,
  TodayItemKind,
} from "@/lib/dashboard/activity";

const ACTIVITY_ICONS: Record<ActivityItemKind, LucideIcon> = {
  source: BookOpen,
  review: Clock3,
  highlight: Pencil,
  chat: MessageCircle,
  quiz: CalendarDays,
};

const TODAY_ICONS: Record<TodayItemKind, LucideIcon> = {
  due: Layers,
  review: Clock3,
  source: BookOpen,
  highlight: Pencil,
  quiz: CalendarDays,
};

const TIPS = [
  {
    eyebrow: "AKTİF RECALL",
    eyebrowEn: "ACTIVE RECALL",
    title: "Okumayı bırak, hatırla.",
    titleEn: "Stop reading, start recalling.",
    body: "Her bölüm sonunda kitabı kapat, ne hatırladığını yaz. Flashcard'lara otomatik dönüşür.",
    bodyEn:
      "After each chapter close the book and write what you remember. Auto-converts to flashcards.",
  },
  {
    eyebrow: "FEYNMAN",
    eyebrowEn: "FEYNMAN",
    title: "Basitçe anlat, eksiği gör.",
    titleEn: "Explain simply, spot the gaps.",
    body: "Workspace'te bir konuyu sesli anlat, AI hangi noktada bocaladığını tespit eder.",
    bodyEn: "Narrate a topic out loud; AI pinpoints where you got stuck.",
  },
];

export default function DashboardPage() {
  const locale = usePrefs((s) => s.locale);
  const t = useTranslations("dashboard");
  const pick = useLocalePick();
  const { toast } = useToast();
  const dexieWorkspaces = useWorkspaces() ?? [];
  const stats = useDashboardStats();
  const activity = useDashboardActivity();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceRecord | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceRecord | null>(null);
  const now = useCurrentTime();

  // The setup DoneStep deep-links here with `?new=workspace` to jump straight
  // into workspace creation. Read it from window (not useSearchParams, which
  // needs a Suspense boundary under static export) and strip the param so a
  // refresh doesn't reopen the modal.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "workspace") {
      setCreateOpen(true);
      window.history.replaceState(null, "", "/dashboard");
    }
  }, []);

  const pendingCards = stats.dueFlashcardCount;
  const hasWorkspaces = dexieWorkspaces.length > 0;
  const renderedDate = useMemo(
    () => formatFullDate(now, locale),
    [locale, now],
  );

  return (
    <AppShell title={t("dashboard")}>
      <div className="page-container">
        <section className="mb-7 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="eyebrow">{renderedDate}</div>
            <h1 className="mt-2 max-w-[760px] text-[30px] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[40px]">
              {pick("Selam", "Hi")}.
            </h1>
            <p className="mt-3 max-w-[70ch] text-[14px] leading-6 text-ink-3">
              {locale === "en" ? (
                <>
                  <b className="font-semibold text-ink">{pendingCards}</b>{" "}
                  review cards pending and your{" "}
                  <b className="font-semibold text-ink">
                    Renormalization group
                  </b>{" "}
                  summary is halfway.
                </>
              ) : (
                <>
                  Bugün <b className="font-semibold text-ink">{pendingCards}</b>{" "}
                  tekrar kartın bekliyor ve{" "}
                  <b className="font-semibold text-ink">
                    Renormalizasyon grubu
                  </b>{" "}
                  özetin yarı yolda.
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">{t("hizli_not")}</Button>
            <Button
              size="sm"
              variant="accent"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t("yeni_workspace")}
            </Button>
          </div>
        </section>

        <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section>
            <SectionHeader title={t("workspaceler")} />
            {!hasWorkspaces ? (
              <Card
                variant="sunken"
                padding="md"
                className="mt-4 grid min-h-[176px] place-items-center text-center"
              >
                <div>
                  <h3 className="text-[15px] font-semibold text-ink">
                    {pick("Henüz workspace yok", "No workspaces yet")}
                  </h3>
                  <p className="mt-2 max-w-[40ch] text-[13px] text-ink-3">
                    {pick(
                      "İlk çalışma alanını oluşturup PDF'lerini eklemeye başla.",
                      "Create your first workspace and start adding PDFs.",
                    )}
                  </p>
                  <Button
                    size="sm"
                    variant="accent"
                    className="mt-4"
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    {t("yeni_workspace_2")}
                  </Button>
                </div>
              </Card>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {dexieWorkspaces.slice(0, 4).map((w) => (
                    <WorkspaceCard
                      key={w.id}
                      workspace={w}
                      onEdit={() => setEditing(w)}
                      onDelete={() => setDeleting(w)}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    className={cn(
                      "grid min-h-[176px] place-items-center rounded-[var(--radius-lg)] border border-dashed border-rule bg-paper/35 text-center",
                      "transition-[background,border-color,transform] duration-[160ms]",
                      "hover:-translate-y-[1px] hover:border-accent hover:bg-paper-2",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
                    )}
                    aria-label={pick("Yeni workspace oluştur", "Create new workspace")}
                  >
                    <div className="px-4 py-6">
                      <div className="text-[26px] font-light text-accent">+</div>
                      <div className="mt-1 text-[14px] font-medium">
                        {t("yeni_workspace_2")}
                      </div>
                      <div className="mt-1 text-[12px] text-ink-4">
                        {pick(
                          "Yeni bir konu için boş alan",
                          "Empty space for a new topic",
                        )}
                      </div>
                    </div>
                  </button>
                </div>
                {dexieWorkspaces.length > 4 ? (
                  <div className="mt-3 flex justify-end">
                    <Link
                      href="/workspaces"
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-rule px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-paper-3 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                    >
                      {pick(
                        `Tümünü gör (${dexieWorkspaces.length - 4} daha)`,
                        `See all (${dexieWorkspaces.length - 4} more)`,
                      )}
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </div>
                ) : null}
              </>
            )}

            <div className="mt-8">
              <SectionHeader title={t("ogrenme_ipuclari")} />
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {TIPS.map((tip) => (
                  <Card key={tip.eyebrow} padding="md" variant="ghost">
                    <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-accent-ink">
                      {pick(tip.eyebrow, tip.eyebrowEn)}
                    </div>
                    <h4 className="my-2 text-[16px] font-semibold">
                      {pick(tip.title, tip.titleEn)}
                    </h4>
                    <p className="text-[13px] leading-6 text-ink-3">
                      {pick(tip.body, tip.bodyEn)}
                    </p>
                  </Card>
                ))}
              </div>
            </div>
          </section>

          <aside className="flex flex-col gap-5">
            <section>
              <SectionHeader title={t("bugun")} />
              <Card padding="md" className="mt-3">
                {activity.today.length === 0 ? (
                  <EmptyActivity
                    title={pick("Bugün aktivite yok", "No activity today")}
                    body={pick(
                      "Tekrar, kaynak, highlight ve quiz hareketleri burada canlı görünür.",
                      "Reviews, sources, highlights and quiz activity appear here live.",
                    )}
                  />
                ) : (
                  activity.today.map((item, i) => {
                    const Icon = TODAY_ICONS[item.kind];
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "flex items-center justify-between gap-4 py-3 text-[13.5px]",
                          i > 0 && "border-t border-rule-soft",
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-rule-soft bg-paper-2 text-ink-3">
                            <Icon className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-ink">
                              {pick(item.title, item.titleEn)}
                            </div>
                            <div className="mt-0.5 truncate text-[12px] text-ink-3">
                              {pick(item.note, item.noteEn)}
                            </div>
                          </div>
                        </div>
                        <span className="rounded-[8px] border border-rule bg-paper-2 px-2 py-1 font-mono text-[10.5px] text-ink-3">
                          {item.time}
                        </span>
                      </div>
                    );
                  })
                )}
                <Link
                  href={dexieWorkspaces[0] ? `/w/${dexieWorkspaces[0].id}/cards` : "/dashboard"}
                  className="mt-3 block"
                >
                  <Button size="sm" className="w-full justify-center">
                    {t("tum_plani_gor")}
                  </Button>
                </Link>
              </Card>
            </section>

            <section>
              <SectionHeader title={t("son_aktivite")} />
              <Card className="mt-3 overflow-hidden">
                {activity.recent.length === 0 ? (
                  <EmptyActivity
                    title={pick("Henüz aktivite yok", "No recent activity")}
                    body={pick(
                      "Kaynak eklediğinde, kart tekrar ettiğinde veya sohbet kullandığında burası güncellenir.",
                      "This updates when you add sources, review cards, or use chat.",
                    )}
                  />
                ) : (
                  activity.recent.map((a, i) => {
                    const Icon = ACTIVITY_ICONS[a.kind];
                    return (
                      <div
                        key={a.id}
                        className={cn(
                          "flex items-start gap-3 px-4 py-3",
                          i > 0 && "border-t border-rule-soft",
                        )}
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-rule-soft bg-paper-2 text-ink-3">
                          <Icon className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13.5px] text-ink">
                            {pick(a.title, a.titleEn)}
                          </div>
                          <div className="mt-0.5 truncate text-[12px] text-ink-4">
                            {pick(a.meta, a.metaEn)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </Card>
            </section>
          </aside>
        </div>
      </div>

      <WorkspaceFormModal
        open={createOpen}
        mode="create"
        onClose={() => setCreateOpen(false)}
      />
      <WorkspaceFormModal
        open={editing !== null}
        mode="edit"
        initial={editing}
        onClose={() => setEditing(null)}
      />
      {deleting ? (
        <DeleteWorkspaceDialog
          workspace={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            toast({
              variant: "success",
              title: pick("Workspace silindi", "Workspace deleted"),
            });
            setDeleting(null);
          }}
          onError={(err) =>
            toast({
              variant: "error",
              title: pick("Silme başarısız", "Delete failed"),
              description: err,
            })
          }
        />
      ) : null}
    </AppShell>
  );
}

function EmptyActivity({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-4 py-6 text-center">
      <div className="text-[13.5px] font-medium text-ink">{title}</div>
      <div className="mx-auto mt-1 max-w-[28ch] text-[12px] leading-5 text-ink-4">
        {body}
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-[18px] font-semibold leading-tight tracking-[-0.01em]">
        {title}
      </h2>
    </div>
  );
}
