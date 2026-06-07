"use client";

import { Calendar, Network, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ConfirmDeleteModal } from "@/components/ui/ConfirmDeleteModal";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useRoadmapProgress } from "@/lib/db/hooks";
import { deleteRoadmap } from "@/lib/db/roadmaps";
import type { RoadmapRecord, RoadmapTimeframe } from "@/lib/roadmap/types";
import { cn } from "@/lib/utils/cn";

type Props = {
  workspaceId: string;
  roadmap: RoadmapRecord;
};

const TIMEFRAME_TONE: Record<RoadmapTimeframe, string> = {
  daily: "bg-[#4E5E3E]/14 text-[#4E5E3E] border-[#4E5E3E]/25",
  weekly: "bg-[#3C4A58]/14 text-[#3C4A58] border-[#3C4A58]/25",
  monthly: "bg-[#6B3A5E]/14 text-[#6B3A5E] border-[#6B3A5E]/25",
};

function formatRelative(timestamp: number, locale: "tr" | "en"): string {
  const diff = Date.now() - timestamp;
  const min = Math.floor(diff / 60000);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);
  if (locale === "tr") {
    if (min < 1) return "az önce";
    if (min < 60) return `${min} dakika önce`;
    if (hour < 24) return `${hour} saat önce`;
    if (day < 7) return `${day} gün önce`;
    return new Date(timestamp).toLocaleDateString("tr-TR");
  }
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (hour < 24) return `${hour} h ago`;
  if (day < 7) return `${day} d ago`;
  return new Date(timestamp).toLocaleDateString("en-US");
}

export function RoadmapCard({ workspaceId, roadmap }: Props) {
  const pick = useLocalePick();
  const progress = useRoadmapProgress(roadmap.id) ?? { total: 0, done: 0 };
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { toast } = useToast();
  const { total, done } = progress;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const timeframeLabelTr = {
    daily: "Günlük",
    weekly: "Haftalık",
    monthly: "Aylık",
  } as const;
  const timeframeLabelEn = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
  } as const;
  const localeIsTr =
    typeof document !== "undefined" &&
    document.documentElement.lang.startsWith("tr");
  const rel = formatRelative(
    roadmap.createdAt,
    localeIsTr ? "tr" : "en",
  );
  return (
    <Card variant="default" className="relative overflow-hidden">
      <div className="flex items-start gap-2">
      <Link
        href={`/w/${workspaceId}/roadmap/${roadmap.id}`}
        className="flex min-w-0 flex-1 flex-col gap-3 p-1 outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-[8px]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-ink-3" aria-hidden />
              <h3 className="truncate font-serif text-[17px] font-medium text-ink">
                {roadmap.title}
              </h3>
            </div>
            <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-3">
              {roadmap.topic}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Chip
              className={cn(
                "border text-[11px] uppercase tracking-[0.04em] font-medium",
                TIMEFRAME_TONE[roadmap.timeframe],
              )}
            >
              {pick(
                timeframeLabelTr[roadmap.timeframe],
                timeframeLabelEn[roadmap.timeframe],
              )}
            </Chip>
            <div className="flex items-center gap-1 text-[11px] text-ink-4">
              <Calendar className="h-3 w-3" aria-hidden />
              <span>{rel}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-paper-3 overflow-hidden">
            <div
              className="h-full bg-accent transition-[width] duration-[160ms]"
              style={{ width: `${pct}%` }}
              aria-hidden
            />
          </div>
          <span className="font-mono text-[11px] text-ink-3 tabular-nums">
            {done} / {total}
          </span>
        </div>
      </Link>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setConfirmOpen(true);
          }}
          aria-label={pick("Roadmap'i sil", "Delete roadmap")}
          className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-ink-4 transition-colors hover:bg-paper-3 hover:text-err"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <ConfirmDeleteModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={pick("Roadmap'i sil", "Delete roadmap")}
        description={pick(
          `"${roadmap.title}" tamamen silinecek. Bu işlem geri alınamaz.`,
          `"${roadmap.title}" will be permanently removed. This cannot be undone.`,
        )}
        cascade={[
          { label: pick("Node", "Nodes"), count: total },
        ]}
        confirmText={roadmap.title}
        confirmInputLabel={
          <>
            {pick(
              "Onaylamak için roadmap adını yaz: ",
              "To confirm, type the roadmap name: ",
            )}
            <code className="font-mono text-[12.5px] text-err">
              {roadmap.title}
            </code>
          </>
        }
        confirmButtonLabel={pick("Kalıcı olarak sil", "Delete permanently")}
        cancelButtonLabel={pick("İptal", "Cancel")}
        onConfirm={async () => {
          await deleteRoadmap(roadmap.id);
          toast({
            variant: "info",
            title: pick("Roadmap silindi", "Roadmap deleted"),
          });
          setConfirmOpen(false);
        }}
      />
    </Card>
  );
}
