import type {
  CurriculumItemRecord,
  LessonNoteRecord,
  StudyJournalEntryRecord,
  StudySourceRef,
} from "./types";

type LessonNoteExportOptions = {
  item?: CurriculumItemRecord | null | undefined;
  journalEntries?: StudyJournalEntryRecord[] | undefined;
  exportedAt?: number | undefined;
};

type JournalExportOptions = {
  title?: string | undefined;
  exportedAt?: number | undefined;
};

export function lessonNoteToMarkdown(
  note: LessonNoteRecord,
  options: LessonNoteExportOptions = {},
): string {
  const exportedAt = new Date(options.exportedAt ?? Date.now()).toISOString();
  const journalEntries = options.journalEntries ?? [];
  const parts = [
    `# ${note.title}`,
    metadataBlock([
      ["Objective", options.item?.objective],
      ["Status", note.status],
      ["Model", note.modelId],
      ["Exported", exportedAt],
    ]),
    stripDuplicateTitle(note.contentMarkdown, note.title),
    sourceRefsToMarkdown(note.sourceRefs),
  ];

  if (journalEntries.length > 0) {
    parts.push(
      "## Study Journal\n\n" +
        journalEntries
          .map((entry) => journalEntryToMarkdown(entry, 3))
          .join("\n\n"),
    );
  }

  return compactJoin(parts);
}

export function studyJournalToMarkdown(
  entries: StudyJournalEntryRecord[],
  options: JournalExportOptions = {},
): string {
  const title = options.title?.trim() || "Study Journal";
  const exportedAt = new Date(options.exportedAt ?? Date.now()).toISOString();
  const parts = [`# ${title}`, `Exported: ${exportedAt}`];

  if (entries.length === 0) {
    parts.push("No journal entries yet.");
  } else {
    parts.push(entries.map((entry) => journalEntryToMarkdown(entry, 2)).join("\n\n"));
  }

  return compactJoin(parts);
}

export function safeMarkdownFilename(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${slug || "study-note"}.md`;
}

function metadataBlock(rows: Array<[string, string | undefined]>): string {
  return rows
    .filter(([, value]) => Boolean(value?.trim()))
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

function sourceRefsToMarkdown(refs: StudySourceRef[]): string {
  if (refs.length === 0) return "";
  return `## Sources\n\n${refs.map((ref) => `- ${formatSourceRef(ref)}`).join("\n")}`;
}

function formatSourceRef(ref: StudySourceRef): string {
  const details = [
    ref.section,
    ref.chunkIds?.length ? `chunks: ${ref.chunkIds.map((id) => `\`${id}\``).join(", ")}` : "",
    ref.quote ? `quote: ${ref.quote}` : "",
  ].filter(Boolean);

  return [`\`${ref.sourceId}\``, ...details].join(" · ");
}

function journalEntryToMarkdown(
  entry: StudyJournalEntryRecord,
  headingLevel: 2 | 3,
): string {
  const heading = `${"#".repeat(headingLevel)} ${entry.question}`;
  const details = [
    `Created: ${new Date(entry.createdAt).toISOString()}`,
    entry.tags.length ? `Tags: ${entry.tags.map((tag) => `\`${tag}\``).join(", ")}` : "",
  ].filter(Boolean);
  const sources = entry.sourceRefs.length
    ? `\n\nSources:\n${entry.sourceRefs.map((ref) => `- ${formatSourceRef(ref)}`).join("\n")}`
    : "";

  return compactJoin([heading, details.join("\n"), entry.answerMarkdown + sources]);
}

function stripDuplicateTitle(markdown: string, title: string): string {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.replace(new RegExp(`^#\\s+${escapedTitle}\\s*\\n+`, "i"), "").trim();
}

function compactJoin(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n\n")
    .trimEnd();
}
