"use client";

import { Database, HardDrive, Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";
import {
  pruneEmbeddings,
  useStorageQuota,
  type QuotaWarningLevel,
} from "@/lib/storage/quota";

const MB = 1024 * 1024;

const BAR_FILL: Record<QuotaWarningLevel, string> = {
  none: "bg-accent",
  warn: "bg-warn",
  critical: "bg-err",
};

const BADGE_TONE: Record<QuotaWarningLevel, string> = {
  none: "text-ink-3",
  warn: "text-warn",
  critical: "text-err",
};

function formatMb(bytes: number): string {
  return (bytes / MB).toFixed(1);
}

export function QuotaSection() {
  const t = useTranslations("quota");
  const { used, total, level } = useStorageQuota();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const ratio = total > 0 ? Math.min(1, used / total) : 0;
  const percent = (ratio * 100).toFixed(1);
  const canPrune = level !== "none";

  const handlePrune = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await pruneEmbeddings();
      toast({
        title: t("pruned_title"),
        description: t("pruned_desc", { count: result.cleared }),
        variant: "success",
      });
      setConfirmOpen(false);
    } catch (err) {
      toast({
        title: t("prune_failed_title"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }, [t, toast]);

  return (
    <>
      <Card padding="lg">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-serif text-[18px] font-medium">
              {t("title")}
            </div>
            <div className="mt-1 text-[12.5px] text-ink-3">{t("desc")}</div>
          </div>
          <HardDrive
            className={cn("h-5 w-5 shrink-0", BADGE_TONE[level])}
            aria-hidden
          />
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="font-mono text-ink-2 tabular-nums">
              {t("used_of", {
                used: formatMb(used),
                total: formatMb(total),
              })}
            </span>
            <span
              className={cn(
                "font-mono text-[11.5px] tabular-nums",
                BADGE_TONE[level],
              )}
            >
              {percent}%
            </span>
          </div>
          <div
            className="relative h-2 w-full overflow-hidden rounded-full bg-paper-3"
            role="progressbar"
            aria-valuenow={Math.round(ratio * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cn(
                "h-full transition-[width] duration-300 ease-out",
                BAR_FILL[level],
              )}
              style={{ width: `${Math.max(2, ratio * 100)}%` }}
            />
          </div>
          {level !== "none" ? (
            <div
              className={cn(
                "flex items-start gap-1.5 text-[12px]",
                BADGE_TONE[level],
              )}
            >
              <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                {level === "critical" ? t("warn_critical") : t("warn_warn")}
              </span>
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-[12px] text-ink-3">{t("prune_hint")}</div>
          <Button
            variant={level === "critical" ? "accent" : "default"}
            disabled={!canPrune || busy}
            onClick={() => setConfirmOpen(true)}
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {t("prune_cta")}
          </Button>
        </div>
      </Card>

      <Modal
        open={confirmOpen}
        onClose={busy ? () => {} : () => setConfirmOpen(false)}
        title={t("prune_confirm_title")}
        description={t("prune_confirm_desc")}
        size="sm"
        closeOnBackdrop={!busy}
        closeOnEsc={!busy}
        footer={
          <>
            <Button
              variant="default"
              onClick={() => setConfirmOpen(false)}
              disabled={busy}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => void handlePrune()}
              loading={busy}
            >
              {t("prune_confirm_cta")}
            </Button>
          </>
        }
      />
    </>
  );
}
