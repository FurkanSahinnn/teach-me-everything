"use client";

import { Download, KeyRound, ShieldAlert, Upload } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import {
  defaultBackupFilename,
  exportBackup,
} from "@/lib/backup/export";
import {
  BackupIntegrityError,
  BackupParseError,
  BackupSchemaError,
  importBackup,
  previewImport,
  type ImportPreview,
} from "@/lib/backup/import";
import { downloadBlob, pickFile } from "@/lib/storage/file-handle";

type Stage = "idle" | "preview" | "importing";

export function BackupSection() {
  const t = useTranslations("backup");
  const { toast } = useToast();

  const [exporting, setExporting] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const handleExport = useCallback(async (): Promise<void> => {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await exportBackup();
      downloadBlob(blob, defaultBackupFilename());
      toast({
        title: t("exported_title"),
        description: t("exported_desc"),
        variant: "success",
      });
    } catch (err) {
      toast({
        title: t("export_failed_title"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setExporting(false);
    }
  }, [exporting, toast, t]);

  const handleRestoreClick = useCallback(async (): Promise<void> => {
    const file = await pickFile(".tmebak,application/json");
    if (!file) return;
    try {
      const next = await previewImport(file);
      setPendingFile(file);
      setPreview(next);
      setStage("preview");
    } catch (err) {
      const description =
        err instanceof BackupSchemaError
          ? t("error_schema", { version: err.receivedVersion })
          : err instanceof BackupIntegrityError
            ? t("error_integrity")
            : err instanceof BackupParseError
              ? t("error_parse")
              : err instanceof Error
                ? err.message
                : String(err);
      toast({
        title: t("preview_failed_title"),
        description,
        variant: "error",
      });
    }
  }, [t, toast]);

  const closeModal = useCallback((): void => {
    if (stage === "importing") return;
    setStage("idle");
    setPreview(null);
    setPendingFile(null);
  }, [stage]);

  const handleConfirmImport = useCallback(async (): Promise<void> => {
    if (!pendingFile) return;
    setStage("importing");
    try {
      const result = await importBackup(pendingFile, { onConflict: "remap" });
      toast({
        title: t("import_done_title"),
        description: t("import_done_desc", {
          imported: result.imported,
          remapped: result.remapped,
        }),
        variant: "success",
      });
      setStage("idle");
      setPreview(null);
      setPendingFile(null);
    } catch (err) {
      toast({
        title: t("import_failed_title"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
      setStage("preview");
    }
  }, [pendingFile, t, toast]);

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
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => void handleExport()}
            loading={exporting}
          >
            <Download className="h-4 w-4" aria-hidden />
            {t("export_cta")}
          </Button>
          <Button
            variant="default"
            onClick={() => void handleRestoreClick()}
          >
            <Upload className="h-4 w-4" aria-hidden />
            {t("restore_cta")}
          </Button>
        </div>

        <Card variant="ghost" padding="md" className="mt-4">
          <div className="flex items-start gap-2.5">
            <KeyRound
              className="mt-0.5 h-4 w-4 shrink-0 text-warn"
              aria-hidden
            />
            <div className="min-w-0 text-[12.5px] text-ink-2">
              <div className="font-medium text-ink">
                {t("keys_excluded_title")}
              </div>
              <div className="mt-0.5 text-ink-3">
                {t("keys_excluded_desc")}
              </div>
            </div>
          </div>
        </Card>
      </Card>

      <Modal
        open={stage !== "idle"}
        onClose={closeModal}
        title={t("preview_title")}
        description={t("preview_desc")}
        size="md"
        closeOnBackdrop={stage !== "importing"}
        closeOnEsc={stage !== "importing"}
        footer={
          <>
            <Button
              variant="default"
              onClick={closeModal}
              disabled={stage === "importing"}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleConfirmImport()}
              loading={stage === "importing"}
              disabled={!preview}
            >
              {t("confirm_import")}
            </Button>
          </>
        }
      >
        {preview ? (
          <div className="space-y-3 text-[13px]">
            <div className="grid grid-cols-3 gap-2">
              <Stat label={t("workspaces")} value={preview.workspaceCount} />
              <Stat label={t("sources")} value={preview.sourceCount} />
              <Stat label={t("flashcards")} value={preview.flashcardCount} />
            </div>
            {preview.conflictingWorkspaceIds.length > 0 ? (
              <Card variant="ghost" padding="md">
                <div className="flex items-start gap-2.5">
                  <ShieldAlert
                    className="mt-0.5 h-4 w-4 shrink-0 text-warn"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-ink">
                      {t("conflicts_title", {
                        count: preview.conflictingWorkspaceIds.length,
                      })}
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-3">
                      {t("conflicts_desc")}
                    </div>
                  </div>
                </div>
              </Card>
            ) : null}
            <div className="text-[11.5px] text-ink-3">
              {t("schema_version", { version: preview.schemaVersion })}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card variant="sunken" padding="md">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
        {label}
      </div>
      <div className="mt-1 font-serif text-[20px] font-medium tabular-nums">
        {value}
      </div>
    </Card>
  );
}
