import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkNoIndentedCode } from "@/lib/markdown/remark-no-indented-code";
import {
  lessonNoteToMarkdown,
  studyJournalToMarkdown,
} from "./export";
import type {
  CurriculumItemRecord,
  LessonNoteRecord,
  StudyJournalEntryRecord,
} from "./types";

export type PdfTheme = "white" | "sepia" | "dark";

type LessonNotePdfOptions = {
  item?: CurriculumItemRecord | null | undefined;
  journalEntries?: StudyJournalEntryRecord[] | undefined;
  exportedAt?: number | undefined;
  theme?: PdfTheme | undefined;
};

type StudyJournalPdfOptions = {
  title?: string | undefined;
  exportedAt?: number | undefined;
  theme?: PdfTheme | undefined;
};

const THEME_VARS: Record<PdfTheme, Record<string, string>> = {
  white: {
    bg: "#fdfbf6",
    ink: "#1a1a1a",
    "ink-2": "#3a3631",
    "ink-3": "#6e6a5f",
    "ink-4": "#9a9588",
    accent: "#b8923f",
    "accent-soft": "#d4ae5e",
    rule: "#ebe6d8",
    "rule-soft": "#f4eedd",
    wash: "#faf6ed",
    code: "#f4f1ec",
  },
  sepia: {
    bg: "#f4ecd8",
    ink: "#2a2418",
    "ink-2": "#3f3a2a",
    "ink-3": "#6b6346",
    "ink-4": "#8e8769",
    accent: "#8b6914",
    "accent-soft": "#a78536",
    rule: "#d8c8a3",
    "rule-soft": "#e3d6b6",
    wash: "#ebe1c8",
    code: "#ebe1c8",
  },
  dark: {
    bg: "#1c1a17",
    ink: "#ebe6d8",
    "ink-2": "#bcb4a0",
    "ink-3": "#8a8472",
    "ink-4": "#5e5b50",
    accent: "#d4a85a",
    "accent-soft": "#a88240",
    rule: "#3a342a",
    "rule-soft": "#2a2620",
    wash: "#25221d",
    code: "#252320",
  },
};

const STYLE_RULES = `
@page { size: A4; margin: 18mm 16mm; }
.tme-pdf-doc {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ink);
  background: var(--bg);
  font-size: 11pt;
  line-height: 1.55;
  padding: 14pt 0 10pt;
}
.tme-pdf-doc h1 {
  font-family: "Source Serif 4", "Charter", Georgia, serif;
  font-size: 22pt;
  font-weight: 600;
  margin: 0 0 6pt;
  letter-spacing: -0.01em;
  color: var(--ink);
}
.tme-pdf-doc h2 {
  font-family: "Source Serif 4", Georgia, serif;
  font-size: 16pt;
  font-weight: 600;
  margin: 18pt 0 6pt;
  color: var(--ink);
  page-break-after: avoid;
}
.tme-pdf-doc h3 {
  font-family: "Source Serif 4", Georgia, serif;
  font-size: 13pt;
  font-weight: 600;
  margin: 14pt 0 4pt;
  color: var(--ink);
  page-break-after: avoid;
}
.tme-pdf-doc h4 {
  font-size: 11.5pt;
  font-weight: 600;
  margin: 10pt 0 3pt;
  color: var(--ink);
}
.tme-pdf-doc p { margin: 6pt 0; }
.tme-pdf-doc strong { color: var(--ink); font-weight: 600; }
.tme-pdf-doc em { font-style: italic; }
.tme-pdf-doc ul, .tme-pdf-doc ol { margin: 6pt 0; padding-left: 18pt; }
.tme-pdf-doc li { margin: 2pt 0; }
.tme-pdf-doc blockquote {
  border-left: 2pt solid var(--accent);
  background: var(--wash);
  margin: 8pt 0;
  padding: 6pt 10pt;
  color: var(--ink-2);
}
.tme-pdf-doc code {
  font-family: ui-monospace, "JetBrains Mono", "Fira Code", monospace;
  font-size: 0.9em;
  background: var(--code);
  padding: 0.08em 0.3em;
  border-radius: 3px;
}
.tme-pdf-doc pre {
  background: var(--code);
  padding: 8pt 10pt;
  border-radius: 4px;
  font-size: 9.5pt;
  line-height: 1.4;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
  page-break-inside: avoid;
}
.tme-pdf-doc pre code {
  background: transparent;
  padding: 0;
  font-size: inherit;
}
.tme-pdf-doc table {
  border-collapse: collapse;
  width: 100%;
  margin: 8pt 0;
  page-break-inside: avoid;
}
.tme-pdf-doc th, .tme-pdf-doc td {
  border: 1px solid var(--rule);
  padding: 4pt 6pt;
  text-align: left;
  vertical-align: top;
  font-size: 10pt;
}
.tme-pdf-doc th { background: var(--wash); font-weight: 600; }
.tme-pdf-doc a { color: var(--accent); text-decoration: underline; }
.tme-pdf-doc hr { border: 0; border-top: 1pt solid var(--rule); margin: 14pt 0; }
.tme-pdf-doc .cit-mark {
  font-size: 0.75em;
  vertical-align: super;
  color: var(--accent);
  margin: 0 0.05em;
  letter-spacing: 0.02em;
}
.tme-pdf-doc .pdf-meta {
  font-family: ui-monospace, monospace;
  font-size: 8.5pt;
  color: var(--ink-3);
  border-bottom: 1px solid var(--rule);
  padding-bottom: 6pt;
  margin: 0 0 14pt;
  display: flex;
  flex-wrap: wrap;
  gap: 4pt 14pt;
}
.tme-pdf-doc .pdf-meta span { white-space: nowrap; }
.tme-pdf-doc .pdf-meta b { font-weight: 600; color: var(--ink-2); }
`;

const META_KV_RX = /^([A-Za-z][\w\s-]*?):\s+(.+)$/;

function buildStyleBlock(theme: PdfTheme): string {
  const vars = THEME_VARS[theme];
  const cssVars = Object.entries(vars)
    .map(([k, v]) => `--${k}: ${v};`)
    .join(" ");
  return `<style>:root, .tme-pdf-doc { ${cssVars} } ${STYLE_RULES}</style>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/^\s*>\s-\s/gm, "> - ")
    .replace(/^\s*>\s(?=\S)/gm, "> ");
}

// Lift the leading `Label: value` block emitted by lessonNoteToMarkdown into
// a styled meta row. The block is always preceded by a blank line and followed
// by another (compactJoin uses \n\n separators), which gives us a clean stop
// condition that won't bleed into content paragraphs.
function extractAndRenderMeta(markdown: string): {
  meta: string | null;
  rest: string;
} {
  const lines = markdown.split("\n");
  const titleIdx = lines.findIndex((l) => l.startsWith("# "));
  if (titleIdx === -1) return { meta: null, rest: markdown };
  let i = titleIdx + 1;
  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  const start = i;
  const metaPairs: Array<[string, string]> = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    const m = line.match(META_KV_RX);
    if (!m) break;
    const label = m[1];
    const value = m[2];
    if (!label || !value) break;
    metaPairs.push([label, value]);
    i++;
  }
  if (metaPairs.length === 0) return { meta: null, rest: markdown };
  const before = lines.slice(0, start).join("\n");
  const after = lines.slice(i).join("\n");
  const metaHtml =
    `<div class="pdf-meta">` +
    metaPairs
      .map(
        ([k, v]) =>
          `<span><b>${escapeHtml(k)}:</b> ${escapeHtml(v)}</span>`,
      )
      .join("") +
    `</div>`;
  return { meta: metaHtml, rest: `${before}\n\n${after}` };
}

function markdownToHtml(markdown: string): string {
  const tree = createElement(
    ReactMarkdown,
    { remarkPlugins: [remarkGfm, remarkNoIndentedCode] },
    normalizeMarkdown(markdown),
  );
  let html = renderToStaticMarkup(tree);
  // Citation tokens flow through the markdown as plain text. Promote them
  // to footnote-style superscripts so PDFs read like a printed paper.
  html = html.replace(/\[§([^\]]+)\]/g, (_match, ref: string) => {
    return `<sup class="cit-mark">[${escapeHtml(ref)}]</sup>`;
  });
  return html;
}

function wrapDoc({
  title,
  theme,
  body,
}: {
  title: string;
  theme: PdfTheme;
  body: string;
}): string {
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    buildStyleBlock(theme) +
    `</head><body class="tme-pdf-doc">${body}</body></html>`
  );
}

export function lessonNoteToHtml(
  note: LessonNoteRecord,
  options: LessonNotePdfOptions = {},
): string {
  const theme = options.theme ?? "white";
  const markdown = lessonNoteToMarkdown(note, {
    ...(options.item !== undefined ? { item: options.item } : {}),
    ...(options.journalEntries !== undefined
      ? { journalEntries: options.journalEntries }
      : {}),
    ...(options.exportedAt !== undefined
      ? { exportedAt: options.exportedAt }
      : {}),
  });
  const { meta, rest } = extractAndRenderMeta(markdown);
  const body = markdownToHtml(rest);
  return wrapDoc({
    title: note.title,
    theme,
    body: meta ? `${meta}${body}` : body,
  });
}

export function studyJournalToHtml(
  entries: StudyJournalEntryRecord[],
  options: StudyJournalPdfOptions = {},
): string {
  const theme = options.theme ?? "white";
  const markdown = studyJournalToMarkdown(entries, {
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.exportedAt !== undefined
      ? { exportedAt: options.exportedAt }
      : {}),
  });
  const docTitle = options.title?.trim() || "Study Journal";
  const body = markdownToHtml(markdown);
  return wrapDoc({ title: docTitle, theme, body });
}

export function safePdfFilename(title: string): string {
  const slug = title
    // Turkish dotless ı / İ are NOT decomposed by NFKD; map them explicitly
    // before normalize so filenames like "Çalışma Günlüğü" don't become
    // "cal-sma-gunlugu". (NFKD does handle ş ğ ü ö ç İ via combining marks.)
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || "study-note"}.pdf`;
}

async function renderHtmlToPdf(html: string, filename: string): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("PDF export is only available in the browser");
  }
  const mod = await import("html2pdf.js");
  const html2pdf = mod.default;
  await html2pdf()
    .from(html)
    .set({
      filename,
      margin: [12, 12, 12, 12],
      // The published Html2PdfOptions interface omits `pagebreak` even
      // though the library supports it. Avoiding pagebreak hints would
      // routinely split tables and code blocks across pages, so we keep
      // the runtime config and silence the missing type locally.
      // @ts-expect-error -- pagebreak is supported but missing in upstream types
      pagebreak: { mode: ["avoid-all", "css", "legacy"] },
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: null },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    })
    .save();
}

export async function exportLessonNoteAsPdf(
  note: LessonNoteRecord,
  options: LessonNotePdfOptions = {},
): Promise<void> {
  const html = lessonNoteToHtml(note, options);
  await renderHtmlToPdf(html, safePdfFilename(note.title));
}

export async function exportStudyJournalAsPdf(
  entries: StudyJournalEntryRecord[],
  options: StudyJournalPdfOptions = {},
): Promise<void> {
  const docTitle = options.title?.trim() || "study-journal";
  const html = studyJournalToHtml(entries, options);
  await renderHtmlToPdf(html, safePdfFilename(docTitle));
}
