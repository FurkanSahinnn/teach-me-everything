"use client";

// Phase 8 follow-up — "Çalışma alanları" listing page. Surfaces every
// workspace as a grid + a search box; the dashboard caps at 4 with a
// "Tümünü gör" link landing here, and the sidebar caps its workspace
// list at 5 with the same overflow link. Reuses WorkspaceCard +
// DeleteWorkspaceDialog from src/components/workspaces/.

import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import {
  DeleteWorkspaceDialog,
  WorkspaceCard,
} from "@/components/workspaces/WorkspaceCard";
import { WorkspaceFormModal } from "@/components/workspaces/WorkspaceFormModal";
import { useWorkspaces } from "@/lib/db/hooks";
import type { WorkspaceRecord } from "@/lib/db/types";
import { useLocalePick } from "@/i18n/IntlProvider";
import { cn } from "@/lib/utils/cn";

export default function WorkspacesPage() {
  const t = useTranslations("dashboard");
  const pick = useLocalePick();
  const { toast } = useToast();
  const workspaces = useWorkspaces() ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceRecord | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceRecord | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter((w) => {
      const tr = w.name.toLowerCase();
      const en = (w.nameEn ?? "").toLowerCase();
      const goal = (w.goal ?? "").toLowerCase();
      const goalEn = (w.goalEn ?? "").toLowerCase();
      return tr.includes(q) || en.includes(q) || goal.includes(q) || goalEn.includes(q);
    });
  }, [workspaces, query]);

  const totalCount = workspaces.length;
  const hasAny = totalCount > 0;
  const matchedCount = filtered.length;

  return (
    <AppShell title={pick("Çalışma alanları", "Workspaces")}>
      <div className="page-container">
        <section className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="eyebrow">{pick("Tüm çalışma alanları", "All workspaces")}</div>
            <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[34px]">
              {pick("Çalışma alanları", "Workspaces")}
            </h1>
            <p className="mt-2 max-w-[60ch] text-[13.5px] leading-6 text-ink-3">
              {pick(
                `Toplam ${totalCount} çalışma alanı. Her biri ayrı kaynak seti ve öğrenme akışıdır.`,
                `${totalCount} workspace${totalCount === 1 ? "" : "s"} total. Each one is an isolated source set and learning loop.`,
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="accent" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t("yeni_workspace")}
            </Button>
          </div>
        </section>

        {hasAny ? (
          <section className="mb-5">
            <div className="relative max-w-[420px]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={pick("Çalışma alanı ara…", "Search workspaces…")}
                aria-label={pick("Çalışma alanlarında ara", "Search workspaces")}
                className="pl-9"
              />
            </div>
            {query.trim() && matchedCount !== totalCount ? (
              <p className="mt-2 text-[12.5px] text-ink-3">
                {pick(
                  `${matchedCount} / ${totalCount} eşleşme`,
                  `${matchedCount} of ${totalCount} matches`,
                )}
              </p>
            ) : null}
          </section>
        ) : null}

        {!hasAny ? (
          <Card
            variant="sunken"
            padding="md"
            className="mt-4 grid min-h-[260px] place-items-center text-center"
          >
            <div>
              <h3 className="text-[17px] font-semibold text-ink">
                {pick("Henüz workspace yok", "No workspaces yet")}
              </h3>
              <p className="mt-2 max-w-[42ch] text-[13px] text-ink-3">
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
        ) : matchedCount === 0 ? (
          <Card variant="sunken" padding="md" className="grid min-h-[200px] place-items-center text-center">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">
                {pick("Eşleşme yok", "No matches")}
              </h3>
              <p className="mt-1 max-w-[40ch] text-[13px] text-ink-3">
                {pick(
                  `"${query}" araması hiçbir çalışma alanıyla eşleşmedi.`,
                  `"${query}" did not match any workspace.`,
                )}
              </p>
              <Button size="sm" className="mt-3" onClick={() => setQuery("")}>
                {pick("Aramayı temizle", "Clear search")}
              </Button>
            </div>
          </Card>
        ) : (
          <div
            className={cn(
              "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
            )}
          >
            {filtered.map((w) => (
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
        )}
      </div>

      <WorkspaceFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        mode="create"
      />
      <WorkspaceFormModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        mode="edit"
        initial={editing}
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
          onError={(message) => {
            toast({
              variant: "error",
              title: pick("Silme başarısız", "Delete failed"),
              description: message,
            });
          }}
        />
      ) : null}
    </AppShell>
  );
}
