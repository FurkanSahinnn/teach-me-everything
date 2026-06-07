import { db } from "./schema";

export type SearchResultKind =
  | "workspace"
  | "source"
  | "highlight"
  | "flashcard"
  | "chunk"
  | "note";

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  workspaceId?: string | undefined;
  title: string;
  subtitle?: string | undefined;
  snippet?: string | undefined;
  href: string;
}

export type SearchOptions = {
  limit?: number;
  perGroupLimit?: number;
};

const KIND_ORDER: Record<SearchResultKind, number> = {
  workspace: 0,
  source: 1,
  note: 2,
  flashcard: 3,
  highlight: 4,
  chunk: 5,
};

const CHUNK_SCAN_CAP = 100;

function makeSnippet(text: string, q: string, radius = 60): string {
  const haystack = text.toLowerCase();
  const idx = haystack.indexOf(q);
  if (idx < 0) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + q.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

export async function searchAll(
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];

  const limit = opts.limit ?? 30;
  const perGroup = opts.perGroupLimit ?? 6;

  const [workspaces, sources, highlights, flashcards, chunks, notes] =
    await Promise.all([
      db.workspaces
        .filter((w) => {
          if (w.archivedAt !== null) return false;
          const name = w.name.toLowerCase();
          if (name.includes(q)) return true;
          if (w.nameEn && w.nameEn.toLowerCase().includes(q)) return true;
          if (w.goal && w.goal.toLowerCase().includes(q)) return true;
          if (w.goalEn && w.goalEn.toLowerCase().includes(q)) return true;
          return false;
        })
        .limit(perGroup)
        .toArray(),
      db.sources
        .filter((s) => {
          if (s.title.toLowerCase().includes(q)) return true;
          if (s.titleEn && s.titleEn.toLowerCase().includes(q)) return true;
          if (s.author && s.author.toLowerCase().includes(q)) return true;
          return false;
        })
        .limit(perGroup)
        .toArray(),
      db.highlights
        .filter((h) => h.text.toLowerCase().includes(q))
        .limit(perGroup)
        .toArray(),
      db.flashcards
        .filter((c) => {
          if (c.question.toLowerCase().includes(q)) return true;
          if (c.questionEn && c.questionEn.toLowerCase().includes(q))
            return true;
          if (c.answer.toLowerCase().includes(q)) return true;
          if (c.answerEn && c.answerEn.toLowerCase().includes(q)) return true;
          return false;
        })
        .limit(perGroup)
        .toArray(),
      db.chunks
        .limit(CHUNK_SCAN_CAP)
        .toArray()
        .then((rows) =>
          rows
            .filter((c) => c.text.toLowerCase().includes(q))
            .slice(0, perGroup),
        ),
      db.notes
        .filter((n) => {
          if (n.title.toLowerCase().includes(q)) return true;
          if (n.content.toLowerCase().includes(q)) return true;
          return false;
        })
        .limit(perGroup)
        .toArray(),
    ]);

  const results: SearchResult[] = [];

  for (const w of workspaces) {
    results.push({
      kind: "workspace",
      id: w.id,
      workspaceId: w.id,
      title: w.name,
      subtitle: w.goal,
      href: `/w/${w.id}`,
    });
  }

  for (const s of sources) {
    results.push({
      kind: "source",
      id: s.id,
      workspaceId: s.workspaceId,
      title: s.title,
      subtitle: s.author,
      href: `/w/${s.workspaceId}/read/${s.id}`,
    });
  }

  for (const c of flashcards) {
    results.push({
      kind: "flashcard",
      id: c.id,
      workspaceId: c.workspaceId,
      title: c.question,
      subtitle: c.answer,
      snippet: makeSnippet(`${c.question} — ${c.answer}`, q),
      href: `/w/${c.workspaceId}/cards?card=${c.id}`,
    });
  }

  for (const h of highlights) {
    results.push({
      kind: "highlight",
      id: h.id,
      workspaceId: h.workspaceId,
      title: h.text.slice(0, 80),
      subtitle: h.userNote,
      snippet: makeSnippet(h.text, q),
      href: `/w/${h.workspaceId}/read/${h.sourceId}?h=${h.id}`,
    });
  }

  for (const ck of chunks) {
    results.push({
      kind: "chunk",
      id: ck.id,
      workspaceId: ck.workspaceId,
      title: ck.section ?? `Chunk ${ck.index + 1}`,
      snippet: makeSnippet(ck.text, q),
      href: `/w/${ck.workspaceId}/read/${ck.sourceId}#chunk-${ck.id}`,
    });
  }

  for (const n of notes) {
    results.push({
      kind: "note",
      id: n.id,
      workspaceId: n.workspaceId,
      title: n.title,
      snippet: makeSnippet(n.content, q),
      href: `/w/${n.workspaceId}/notes?id=${n.id}`,
    });
  }

  results.sort((a, b) => {
    const orderDelta = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (orderDelta !== 0) return orderDelta;
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });

  return results.slice(0, limit);
}
