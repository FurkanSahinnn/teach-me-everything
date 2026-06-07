"use client";

import {
  ArrowLeft,
  BookOpen,
  Download,
  ExternalLink,
  FileDown,
  NotebookPen,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { MarkdownPreview } from "@/components/markdown/MarkdownPreview";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import {
  useLessonNotesByWorkspace,
  useSources,
  useStudyJournalEntries,
  useWorkspace,
} from "@/lib/db/hooks";
import { deleteStudyJournalEntry } from "@/lib/db/study";
import { downloadBlob } from "@/lib/storage/file-handle";
import {
  safeMarkdownFilename,
  studyJournalToMarkdown,
} from "@/lib/study/export";
import type { StudyJournalEntryRecord } from "@/lib/study/types";
import { formatRelativeDay } from "@/lib/utils/intl";

const ALL = "all" as const;
type AllOr<T extends string> = typeof ALL | T;

export default function StudyJournalPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = params.id;
  const workspace = useWorkspace(workspaceId);
  const entries = useStudyJournalEntries(workspaceId);
  const lessons = useLessonNotesByWorkspace(workspaceId);
  const sources = useSources(workspaceId);
  const t = useTranslations("study_journal");
  const pick = useLocalePick();
  const { toast } = useToast();

  const [lessonFilter, setLessonFilter] = useState<AllOr<string>>(ALL);
  const [sourceFilter, setSourceFilter] = useState<AllOr<string>>(ALL);
  const [tagFilter, setTagFilter] = useState<AllOr<string>>(ALL);
  const [pendingDelete, setPendingDelete] = useState<StudyJournalEntryRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  // pdfBusy holds the entry id (or "bulk") of the currently exporting PDF, or
  // null when idle. Used to disable other PDF buttons during export so we
  // don't race html2pdf.js against itself.
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  const lessonOptions = useMemo(
    () => lessons.map((l) => ({ id: l.id, title: l.title })),
    [lessons],
  );
  const sourceOptions = useMemo(
    () =>
      sources.map((s) => ({
        id: s.id,
        title: pick(s.title, s.titleEn ?? s.title),
      })),
    [sources, pick],
  );
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) for (const tag of e.tags) set.add(tag);
    return [...set].sort();
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (lessonFilter !== ALL && e.lessonNoteId !== lessonFilter) return false;
      if (sourceFilter !== ALL && e.sourceId !== sourceFilter) return false;
      if (tagFilter !== ALL && !e.tags.includes(tagFilter)) return false;
      return true;
    });
  }, [entries, lessonFilter, sourceFilter, tagFilter]);

  if (workspace === undefined) {
    return (
      <AppShell
        workspaceId={workspaceId}
        breadcrumb={["Dashboard", pick("Çalışma günlüğü", "Study journal")]}
      >
        <div className="page-container">
          <Skeleton variant="rect" height={44} width="40%" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} padding="md">
                <Skeleton variant="text" lines={4} />
              </Card>
            ))}
          </div>
        </div>
      </AppShell>
    );
  }
  if (workspace === null) {
    notFound();
  }

  const lessonsById = new Map(lessons.map((l) => [l.id, l]));
  const sourcesById = new Map(sources.map((s) => [s.id, s]));

  const handleEntryExport = (entry: StudyJournalEntryRecord): void => {
    const md = studyJournalToMarkdown([entry], { title: entry.question });
    downloadBlob(
      new Blob([md], { type: "text/markdown;charset=utf-8" }),
      safeMarkdownFilename(entry.question),
    );
  };

  const handleBulkExport = (): void => {
    if (filtered.length === 0) return;
    const titleBase = workspace.name
      ? `${workspace.name} — ${pick("Çalışma günlüğü", "Study journal")}`
      : pick("Çalışma günlüğü", "Study journal");
    const md = studyJournalToMarkdown(filtered, { title: titleBase });
    downloadBlob(
      new Blob([md], { type: "text/markdown;charset=utf-8" }),
      safeMarkdownFilename(`${workspace.name ?? "study"} journal`),
    );
  };

  const handleEntryPdfExport = async (
    entry: StudyJournalEntryRecord,
  ): Promise<void> => {
    if (pdfBusy !== null) return;
    setPdfBusy(entry.id);
    try {
      const { exportStudyJournalAsPdf } = await import(
        "@/lib/study/pdf-export"
      );
      await exportStudyJournalAsPdf([entry], { title: entry.question });
    } catch (err) {
      toast({
        variant: "error",
        title: t("pdf_export_failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPdfBusy(null);
    }
  };

  const handleBulkPdfExport = async (): Promise<void> => {
    if (filtered.length === 0 || pdfBusy !== null) return;
    setPdfBusy("bulk");
    try {
      const titleBase = workspace.name
        ? `${workspace.name} — ${pick("Çalışma günlüğü", "Study journal")}`
        : pick("Çalışma günlüğü", "Study journal");
      const { exportStudyJournalAsPdf } = await import(
        "@/lib/study/pdf-export"
      );
      await exportStudyJournalAsPdf(filtered, { title: titleBase });
    } catch (err) {
      toast({
        variant: "error",
        title: t("pdf_export_failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPdfBusy(null);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteStudyJournalEntry(pendingDelete.id);
      setPendingDelete(null);
      toast({ variant: "success", title: t("deleted") });
    } catch (err) {
      toast({
        variant: "error",
        title: t("delete_failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeleting(false);
    }
  };

  const filterActive =
    lessonFilter !== ALL || sourceFilter !== ALL || tagFilter !== ALL;

  return (
    <AppShell
      workspaceId={workspaceId}
      breadcrumb={["Dashboard", pick(workspace.name, workspace.nameEn ?? workspace.name), pick("Çalışma günlüğü", "Study journal")]}
    >
      <div className="page-container space-y-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <Link
              href={`/w/${workspaceId}/roadmap`}
              className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 hover:text-ink-2"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              {pick("Roadmap'e dön", "Back to roadmap")}
            </Link>
            <h1 className="mt-2 font-serif text-[26px] font-medium leading-tight">
              {t("page_title")}
            </h1>
            <p className="mt-1 text-[13.5px] leading-6 text-ink-3">
              {t("page_desc")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleBulkExport}
              disabled={filtered.length === 0}
              title={t("bulk_export_hint")}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              {t("bulk_export")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={pdfBusy === "bulk"}
              onClick={() => void handleBulkPdfExport()}
              disabled={
                filtered.length === 0 ||
                (pdfBusy !== null && pdfBusy !== "bulk")
              }
              title={t("bulk_export_pdf_hint")}
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden />
              {t("bulk_export_pdf")}
            </Button>
          </div>
        </header>

        <Card padding="md" variant="sunken">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <FilterSelect
              label={t("filter_lesson")}
              value={lessonFilter}
              onChange={setLessonFilter}
              options={lessonOptions.map((l) => ({ value: l.id, label: l.title }))}
              allLabel={t("filter_all_lessons")}
            />
            <FilterSelect
              label={t("filter_source")}
              value={sourceFilter}
              onChange={setSourceFilter}
              options={sourceOptions.map((s) => ({ value: s.id, label: s.title }))}
              allLabel={t("filter_all_sources")}
            />
            <FilterSelect
              label={t("filter_tag")}
              value={tagFilter}
              onChange={setTagFilter}
              options={allTags.map((tag) => ({ value: tag, label: tag }))}
              allLabel={t("filter_all_tags")}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-[12.5px] text-ink-3">
            <span>
              {filtered.length === entries.length
                ? t("count_all", { count: entries.length })
                : t("count_filtered", { shown: filtered.length, total: entries.length })}
            </span>
            {filterActive ? (
              <button
                type="button"
                onClick={() => {
                  setLessonFilter(ALL);
                  setSourceFilter(ALL);
                  setTagFilter(ALL);
                }}
                className="text-accent hover:text-accent-hot"
              >
                {t("clear_filters")}
              </button>
            ) : null}
          </div>
        </Card>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<NotebookPen />}
            title={
              entries.length === 0 ? t("empty_title") : t("empty_filtered_title")
            }
            description={
              entries.length === 0
                ? t("empty_desc")
                : t("empty_filtered_desc")
            }
          />
        ) : (
          <div className="space-y-4">
            {filtered.map((entry) => (
              <JournalEntryCard
                key={entry.id}
                entry={entry}
                lesson={
                  entry.lessonNoteId
                    ? lessonsById.get(entry.lessonNoteId)
                    : undefined
                }
                source={
                  entry.sourceId ? sourcesById.get(entry.sourceId) : undefined
                }
                workspaceId={workspaceId}
                onExport={() => handleEntryExport(entry)}
                onPdfExport={() => void handleEntryPdfExport(entry)}
                pdfBusy={pdfBusy === entry.id}
                pdfDisabled={pdfBusy !== null && pdfBusy !== entry.id}
                onDelete={() => setPendingDelete(entry)}
                pick={pick}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      <Modal
        open={pendingDelete !== null}
        onClose={() => (deleting ? undefined : setPendingDelete(null))}
        title={t("delete_title")}
        description={t("delete_desc")}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              {pick("İptal", "Cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void handleDelete()}
              loading={deleting}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t("delete_confirm")}
            </Button>
          </>
        }
      >
        {pendingDelete ? (
          <div className="rounded-[10px] border border-rule bg-paper-2 px-3 py-2 text-[12.5px] leading-snug text-ink-2">
            {pendingDelete.question.length > 160
              ? `${pendingDelete.question.slice(0, 160)}…`
              : pendingDelete.question}
          </div>
        ) : null}
      </Modal>
    </AppShell>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-[12px] text-ink-3">
      <span className="font-mono uppercase tracking-[0.08em] text-[10.5px]">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-[10px] border border-rule bg-paper px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent"
      >
        <option value={ALL}>{allLabel}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function JournalEntryCard({
  entry,
  lesson,
  source,
  workspaceId,
  onExport,
  onPdfExport,
  pdfBusy,
  pdfDisabled,
  onDelete,
  pick,
  t,
}: {
  entry: StudyJournalEntryRecord;
  lesson: { id: string; title: string } | undefined;
  source: { id: string; title: string; titleEn?: string | undefined | null } | undefined;
  workspaceId: string;
  onExport: () => void;
  onPdfExport: () => void;
  pdfBusy: boolean;
  pdfDisabled: boolean;
  onDelete: () => void;
  pick: (tr: string, en: string) => string;
  t: (key: string) => string;
}) {
  const created = formatRelativeDay(entry.createdAt, pick("tr", "en"));
  return (
    <Card padding="md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-[16px] font-medium leading-snug">
            {entry.question}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-4">
            <span className="font-mono uppercase tracking-[0.06em]">
              {created}
            </span>
            {lesson ? (
              <Link
                href={`/w/${workspaceId}/study/${lesson.id}`}
                className="inline-flex items-center gap-1 text-ink-3 hover:text-accent"
                title={t("open_lesson")}
              >
                <BookOpen className="h-3 w-3" aria-hidden />
                {lesson.title}
              </Link>
            ) : null}
            {source ? (
              <Link
                href={`/w/${workspaceId}/read/${source.id}`}
                className="inline-flex items-center gap-1 text-ink-3 hover:text-accent"
                title={t("open_source")}
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
                {pick(source.title, source.titleEn ?? source.title)}
              </Link>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onExport}
            title={t("entry_export_hint")}
            aria-label={t("entry_export")}
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={pdfBusy}
            disabled={pdfDisabled}
            onClick={onPdfExport}
            title={t("entry_export_pdf_hint")}
            aria-label={t("entry_export_pdf")}
          >
            <FileDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            title={t("delete")}
            aria-label={t("delete")}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="mt-3 rounded-[10px] border border-rule-soft bg-paper-2 p-3">
        <MarkdownPreview
          text={entry.answerMarkdown}
          className="text-[13.5px] leading-6"
        />
      </div>

      {entry.tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {entry.tags.map((tag) => (
            <Chip key={tag} variant="muted" size="sm">
              {tag}
            </Chip>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
