"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Brain,
  ClipboardList,
  Download,
  Eye,
  Pencil,
  Save,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { MarkdownPreview } from "@/components/markdown/MarkdownPreview";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { RegenerateLessonModal } from "@/components/study/RegenerateLessonModal";
import {
  useChunksByIds,
  useCurriculumItem,
  useLessonNote,
  useStudyJournalEntries,
  useWorkspace,
} from "@/lib/db/hooks";
import {
  createStudyJournalEntry,
  updateLessonNote,
} from "@/lib/db/study";
import { useLocalePick } from "@/i18n/IntlProvider";
import { downloadBlob } from "@/lib/storage/file-handle";
import {
  lessonNoteToMarkdown,
  safeMarkdownFilename,
  studyJournalToMarkdown,
} from "@/lib/study/export";
import type { CurriculumItemRecord, StudySourceRef } from "@/lib/study/types";

type AutosaveStatus = "idle" | "saving" | "saved";

export default function StudyLessonPage() {
  const params = useParams<{ id: string; lessonId: string }>();
  const workspaceId = params.id;
  const lessonId = params.lessonId;
  const router = useRouter();
  const note = useLessonNote(lessonId);
  const workspace = useWorkspace(note?.workspaceId ?? workspaceId);
  const item = useCurriculumItem(note?.curriculumItemId);
  const pick = useLocalePick();
  const { toast } = useToast();
  const [pdfBusy, setPdfBusy] = useState<"note" | "journal" | null>(null);
  const chunkIds = useMemo(
    () => Array.from(new Set(note?.sourceRefs.flatMap((ref) => ref.chunkIds ?? []) ?? [])),
    [note],
  );
  const chunks = useChunksByIds(chunkIds);
  const journal = useStudyJournalEntries(note?.workspaceId);
  const lessonJournalEntries = useMemo(
    () => journal.filter((entry) => entry.lessonNoteId === note?.id),
    [journal, note?.id],
  );
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [editValue, setEditValue] = useState<string>("");
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel any pending autosave on unmount so a debounced timer doesn't
  // resolve against a torn-down React tree.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  if (note === undefined || workspace === undefined) {
    return (
      <AppShell
        workspaceId={workspaceId}
        breadcrumb={["Dashboard", "Study"]}
      >
        <div className="page-container">
          <Skeleton variant="rect" height={44} width="40%" />
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card padding="lg">
              <Skeleton variant="text" lines={8} />
            </Card>
            <Card padding="md">
              <Skeleton variant="text" lines={5} />
            </Card>
          </div>
        </div>
      </AppShell>
    );
  }

  if (workspace === null || note.workspaceId !== workspaceId) {
    notFound();
  }

  const handleEnterEdit = (): void => {
    setEditValue(note.contentMarkdown);
    lastSavedRef.current = note.contentMarkdown;
    setAutosaveStatus("idle");
    setMode("edit");
  };

  const handleExitEdit = (): void => {
    // Flush any pending debounce so the user doesn't lose the last keystroke
    // when toggling back to preview.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      if (editValue !== lastSavedRef.current) {
        const value = editValue;
        void updateLessonNote(note.id, { contentMarkdown: value }).then(() => {
          lastSavedRef.current = value;
        });
      }
    }
    setMode("preview");
  };

  const handleEditChange = (next: string): void => {
    setEditValue(next);
    setAutosaveStatus("saving");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    debounceRef.current = setTimeout(async () => {
      debounceRef.current = null;
      try {
        await updateLessonNote(note.id, { contentMarkdown: next });
        lastSavedRef.current = next;
        setAutosaveStatus("saved");
        idleTimerRef.current = setTimeout(() => {
          setAutosaveStatus("idle");
          idleTimerRef.current = null;
        }, 1500);
      } catch {
        setAutosaveStatus("idle");
      }
    }, 1000);
  };

  const handleSaveJournal = async (): Promise<void> => {
    if (!question.trim() || !answer.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await createStudyJournalEntry({
        workspaceId: note.workspaceId,
        lessonNoteId: note.id,
        question: question.trim(),
        answerMarkdown: answer.trim(),
        sourceRefs: note.sourceRefs,
        tags: [note.title.toLowerCase()],
      });
      setQuestion("");
      setAnswer("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleExportNote = (): void => {
    const markdown = lessonNoteToMarkdown(note, {
      item,
      journalEntries: lessonJournalEntries,
    });
    downloadMarkdown(markdown, safeMarkdownFilename(note.title));
  };

  const handleExportJournal = (): void => {
    const markdown = studyJournalToMarkdown(lessonJournalEntries, {
      title: `${note.title} journal`,
    });
    downloadMarkdown(markdown, safeMarkdownFilename(`${note.title} journal`));
  };

  const handleExportNotePdf = async (): Promise<void> => {
    if (pdfBusy !== null) return;
    setPdfBusy("note");
    try {
      const { exportLessonNoteAsPdf } = await import("@/lib/study/pdf-export");
      await exportLessonNoteAsPdf(note, {
        item: item ?? null,
        journalEntries: lessonJournalEntries,
      });
    } catch (err) {
      toast({
        variant: "error",
        title: pick("PDF indirilemedi", "Could not export PDF"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPdfBusy(null);
    }
  };

  const handleExportJournalPdf = async (): Promise<void> => {
    if (pdfBusy !== null) return;
    setPdfBusy("journal");
    try {
      const { exportStudyJournalAsPdf } = await import("@/lib/study/pdf-export");
      await exportStudyJournalAsPdf(lessonJournalEntries, {
        title: `${note.title} journal`,
      });
    } catch (err) {
      toast({
        variant: "error",
        title: pick("PDF indirilemedi", "Could not export PDF"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPdfBusy(null);
    }
  };

  const autosaveLabel = (() => {
    if (autosaveStatus === "saving") return pick("Kaydediliyor…", "Saving…");
    if (autosaveStatus === "saved") return pick("Kaydedildi", "Saved");
    return null;
  })();

  return (
    <AppShell
      workspaceId={workspaceId}
      breadcrumb={["Dashboard", workspace.name, "Study", note.title]}
      topbarActions={
        <div className="flex min-w-0 items-center gap-2">
          {mode === "edit" && autosaveLabel ? (
            <span
              className="hidden font-mono text-[11px] text-ink-3 xl:inline"
              data-testid="autosave-status"
            >
              {autosaveLabel}
            </span>
          ) : null}
          {mode === "preview" ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleEnterEdit}
                className="px-3 xl:px-4"
                title={pick("Düzenle", "Edit")}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden xl:inline">{pick("Düzenle", "Edit")}</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!item}
                onClick={() => setRegenerateOpen(true)}
                className="px-3 xl:px-4"
                title={pick("Yeniden üret", "Regenerate")}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden xl:inline">
                  {pick("Yeniden üret", "Regenerate")}
                </span>
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleExitEdit}
              className="px-3 xl:px-4"
              title={pick("Önizle", "Preview")}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden xl:inline">{pick("Önizle", "Preview")}</span>
            </Button>
          )}
          <Link href={`/w/${workspaceId}/roadmap`}>
            <Button size="sm" className="px-3 xl:px-4" title={pick("Roadmap", "Roadmap")}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden xl:inline">{pick("Roadmap", "Roadmap")}</span>
            </Button>
          </Link>
        </div>
      }
    >
      <div className="mx-auto grid max-w-[1320px] grid-cols-1 gap-6 px-4 pb-20 pt-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
        <main className="min-w-0">
          <div className="mb-5">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
              Roadmap step
            </div>
            <h1 className="mt-1 break-words font-serif text-[28px] font-normal leading-tight tracking-[-0.015em] sm:text-[34px]">
              {note.title}
            </h1>
            {item ? (
              <p className="mt-2 max-w-[72ch] text-[14px] leading-6 text-ink-3">
                {item.objective}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={handleExportNote}
                title={pick("Notu Markdown olarak indir", "Download note as Markdown")}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Note .md
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={pdfBusy === "note"}
                disabled={pdfBusy !== null && pdfBusy !== "note"}
                onClick={() => void handleExportNotePdf()}
                title={pick("Notu PDF olarak indir", "Download note as PDF")}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Note .pdf
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={lessonJournalEntries.length === 0}
                onClick={handleExportJournal}
                title={pick("Günlüğü Markdown olarak indir", "Download journal as Markdown")}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Journal .md
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={pdfBusy === "journal"}
                disabled={
                  lessonJournalEntries.length === 0 ||
                  (pdfBusy !== null && pdfBusy !== "journal")
                }
                onClick={() => void handleExportJournalPdf()}
                title={pick("Günlüğü PDF olarak indir", "Download journal as PDF")}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Journal .pdf
              </Button>
            </div>
          </div>

          {item ? <StudyRoadmap item={item} /> : null}

          <Card padding="xl" className="overflow-hidden p-5 sm:p-8">
            {mode === "edit" ? (
              <textarea
                data-testid="lesson-note-editor"
                value={editValue}
                onChange={(event) => handleEditChange(event.target.value)}
                className="min-h-[420px] w-full resize-y rounded-[10px] border border-rule bg-paper px-4 py-3 font-mono text-[13.5px] leading-6 outline-none focus:border-accent"
                spellCheck
              />
            ) : (
              <MarkdownNote
                markdown={note.contentMarkdown}
                chunks={chunks}
                onCitationClick={(chunk) => {
                  router.push(`/w/${workspaceId}/read/${chunk.sourceId}`);
                }}
              />
            )}
          </Card>
        </main>

        <aside className="space-y-5">
          <Card padding="md">
            <h2 className="font-serif text-[16px] font-medium">Practice</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link href={`/w/${workspaceId}/cards`}>
                <Button size="sm" variant="ghost" className="w-full">
                  <Brain className="h-3.5 w-3.5" aria-hidden />
                  Cards
                </Button>
              </Link>
              <Link href={`/w/${workspaceId}/quiz`}>
                <Button size="sm" variant="ghost" className="w-full">
                  <ClipboardList className="h-3.5 w-3.5" aria-hidden />
                  Quiz
                </Button>
              </Link>
            </div>
          </Card>

          <Card padding="md">
            <h2 className="font-serif text-[16px] font-medium">Sources</h2>
            <div className="mt-3 space-y-2">
              {note.sourceRefs.map((ref, index) => (
                <SourceRefRow
                  key={`${ref.sourceId}-${index}`}
                  refItem={ref}
                  workspaceId={workspaceId}
                />
              ))}
            </div>
          </Card>

          <Card padding="md">
            <h2 className="font-serif text-[16px] font-medium">Backlinks</h2>
            {chunks.length === 0 ? (
              <p className="mt-2 text-[12.5px] leading-5 text-ink-3">
                No chunk backlinks on this note yet.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {chunks.slice(0, 6).map((chunk) => (
                  <Link
                    key={chunk.id}
                    href={`/w/${workspaceId}/read/${chunk.sourceId}`}
                    className="block rounded-[10px] border border-rule bg-paper-2 p-3 text-[12.5px] leading-5 text-ink-3 hover:border-rule-strong hover:bg-paper-3"
                  >
                    <div className="mb-1 truncate font-mono text-[10.5px] text-ink-4">
                      #{chunk.index}
                      {chunk.section ? ` · ${chunk.section}` : ""}
                    </div>
                    <span className="block max-h-[4.9rem] overflow-hidden break-words">
                      {chunk.text.slice(0, 180)}
                    </span>
                    {chunk.text.length > 180 ? "..." : ""}
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card padding="md">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-serif text-[16px] font-medium">Study journal</h2>
              <Link
                href={`/w/${workspaceId}/study/journal`}
                className="text-[11.5px] text-accent hover:text-accent-hot"
              >
                {pick("Tümünü gör →", "View all →")}
              </Link>
            </div>
            <div className="mt-3 space-y-2">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Question"
                className="min-h-20 w-full rounded-[10px] border border-rule bg-paper px-3 py-2 text-[13px] outline-none focus:border-accent"
              />
              <textarea
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Answer"
                className="min-h-24 w-full rounded-[10px] border border-rule bg-paper px-3 py-2 text-[13px] outline-none focus:border-accent"
              />
              <Button
                size="sm"
                variant="primary"
                loading={saving}
                disabled={!question.trim() || !answer.trim()}
                onClick={handleSaveJournal}
              >
                <Save className="h-3.5 w-3.5" aria-hidden />
                Save Q&A
              </Button>
              {saveError ? (
                <p className="text-[12px] text-err">{saveError}</p>
              ) : null}
            </div>
            {lessonJournalEntries.length > 0 ? (
              <div className="mt-4 space-y-3 border-t border-rule-soft pt-3">
                {lessonJournalEntries
                  .slice(0, 3)
                  .map((entry) => (
                    <div key={entry.id} className="text-[12.5px] leading-5">
                      <div className="font-medium text-ink">{entry.question}</div>
                      <div className="mt-1 text-ink-3">{entry.answerMarkdown}</div>
                    </div>
                  ))}
              </div>
            ) : null}
          </Card>
        </aside>
      </div>
      {item ? (
        <RegenerateLessonModal
          open={regenerateOpen}
          onClose={() => setRegenerateOpen(false)}
          workspaceId={workspaceId}
          workspace={{
            name: workspace.name,
            ...(workspace.goal !== undefined ? { goal: workspace.goal } : {}),
          }}
          note={note}
          item={item}
        />
      ) : null}
    </AppShell>
  );
}

function StudyRoadmap({ item }: { item: CurriculumItemRecord }) {
  const steps = [
    {
      label: "Understand",
      title: `What “${item.title}” means`,
      body: item.objective,
    },
    {
      label: "Inspect",
      title: "Read the source passage",
      body: "Use the cited passage below as the evidence for this roadmap step.",
    },
    {
      label: "Explain",
      title: "Say it back in your own words",
      body: `You are done when you can explain why ${item.title.toLowerCase()} matters without looking.`,
    },
    {
      label: "Practice",
      title: "Turn it into recall",
      body: "Add a journal Q&A, then use Cards or Quiz from the right panel.",
    },
  ];

  return (
    <section className="mb-5 rounded-[12px] border border-rule-strong bg-paper-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-4">
            Learning roadmap
          </div>
          <h2 className="mt-1 font-serif text-[18px] font-medium text-ink">
            What to study in this step
          </h2>
        </div>
        <span className="rounded border border-rule bg-paper px-2 py-1 font-mono text-[10.5px] text-ink-3">
          ~{item.estimatedMinutes} min
        </span>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className="rounded-[10px] border border-rule bg-paper px-3 py-3"
          >
            <div className="flex items-center gap-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-accent-soft bg-accent-wash font-mono text-[10px] text-accent-ink">
                {index + 1}
              </span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-4">
                {step.label}
              </span>
            </div>
            <div className="mt-2 text-[13px] font-semibold leading-5 text-ink">
              {step.title}
            </div>
            <p className="mt-1 text-[12.5px] leading-5 text-ink-3">
              {step.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function downloadMarkdown(markdown: string, filename: string): void {
  downloadBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), filename);
}

function SourceRefRow({
  refItem,
  workspaceId,
}: {
  refItem: StudySourceRef;
  workspaceId: string;
}) {
  return (
    <Link
      href={`/w/${workspaceId}/read/${refItem.sourceId}`}
      className="block rounded-[10px] border border-rule bg-paper-2 px-3 py-2 text-[12.5px] leading-5 hover:border-rule-strong hover:bg-paper-3"
    >
      <div className="truncate font-mono text-[10.5px] text-ink-4">
        {refItem.sourceId}
      </div>
      <div className="mt-0.5 truncate text-ink-2">
        {refItem.section ?? `${refItem.chunkIds?.length ?? 0} chunk refs`}
      </div>
    </Link>
  );
}

function MarkdownNote({
  markdown,
  chunks,
  onCitationClick,
}: {
  markdown: string;
  chunks: NonNullable<ReturnType<typeof useChunksByIds>>;
  onCitationClick: (chunk: NonNullable<ReturnType<typeof useChunksByIds>>[number]) => void;
}) {
  if (markdown.trim().length === 0) {
    return (
      <EmptyState
        icon={<BookOpen />}
        title="Empty note"
        description="Generate or write a lesson note to start studying."
      />
    );
  }
  return (
    <article>
      <MarkdownPreview
        text={formatLessonMarkdownForPreview(markdown)}
        citationChunks={chunks}
        onCitationClick={onCitationClick}
        components={{
          blockquote({ children }) {
            return <PassagePreview>{children}</PassagePreview>;
          },
        }}
        className={[
          "max-w-none break-words text-[15px] leading-7",
          "[&_li_h1]:my-1 [&_li_h1]:font-sans [&_li_h1]:text-[15px] [&_li_h1]:leading-7",
          "[&_li_h2]:my-1 [&_li_h2]:font-sans [&_li_h2]:text-[15px] [&_li_h2]:leading-7",
          "[&_li_h3]:my-1 [&_li_h3]:font-sans [&_li_h3]:text-[15px] [&_li_h3]:leading-7",
          "[&_li_p]:my-1 [&_.markdown-inline-code]:break-words",
        ].join(" ")}
      />
    </article>
  );
}

function PassagePreview({ children }: { children: ReactNode }) {
  return (
    <blockquote className="my-4 rounded-[10px] border border-rule-strong bg-paper-2 px-4 py-3 text-[14px] leading-7 text-ink-2">
      <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-4">
        Source passage
      </div>
      <div className="line-clamp-3 text-[13.5px] leading-6 text-ink-3 [&_p]:my-0 [&_strong]:font-medium [&_strong]:text-ink-2">
        {children}
      </div>
    </blockquote>
  );
}

function formatLessonMarkdownForPreview(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let inKeyPassages = false;
  let skipLegacySourceFocus = false;
  return lines
    .map((line) => {
      if (/^#\s+/.test(line.trim())) {
        return "";
      }
      if (/^##\s+Source focus\s*$/i.test(line.trim())) {
        skipLegacySourceFocus = true;
        return "";
      }
      if (skipLegacySourceFocus && /^##\s+/.test(line.trim())) {
        skipLegacySourceFocus = false;
      }
      if (skipLegacySourceFocus) return "";
      if (/^##\s+Key passages\s*$/i.test(line.trim())) {
        inKeyPassages = true;
        return line;
      }
      if (inKeyPassages && /^##\s+/.test(line.trim())) {
        inKeyPassages = false;
      }
      if (!inKeyPassages) return line;
      const match = line.match(/^\s*-\s+(.+)$/);
      if (!match) return line;
      return `> ${cleanPassagePreview(match[1] ?? "")}`;
    })
    .join("\n");
}

function cleanPassagePreview(value: string): string {
  const citation = value.match(/\[(?:Â§|§)[^\]]+\]\s*$/)?.[0] ?? "";
  let body = value.replace(/\[(?:Â§|§)[^\]]+\]\s*$/g, "");
  body = body
    .replace(/\*\*/g, "")
    .replace(/#+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const titleSplit = body.match(/^(.{20,140}?\?)\s+(.+)$/);
  if (titleSplit?.[2]) body = titleSplit[2].trim();
  const formulaIndex = body.search(/\bz\s*=/i);
  if (formulaIndex >= 0 && formulaIndex < 90) body = body.slice(formulaIndex).trim();
  if (body.length > 150) body = `${body.slice(0, 147).trim()}...`;
  return `${body}${citation ? ` ${citation}` : ""}`;
}
