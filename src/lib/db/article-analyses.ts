import { newId } from "@/lib/utils/id";
import { db } from "./schema";
import type {
  AnalysisModelSnapshot,
  AnalysisStatus,
  AnalysisTargetLang,
  AnalysisUsage,
  ArticleAnalysisPayload,
  ArticleAnalysisRecord,
  BriefChatMessage,
  BriefRevision,
} from "@/lib/article-analysis/types";
import { projectBriefToLegacy, type ArticleBrief, type BriefSection } from "@/lib/article-analysis/brief";

// ---------------------------------------------------------------------------
// Article Analysis (one row per AI multi-stage analysis of a single source)
// ---------------------------------------------------------------------------

export type CreateAnalysisInput = {
  workspaceId: string;
  sourceId: string;
  // Source title snapshot so the list survives source rename/delete.
  title: string;
  targetLang: AnalysisTargetLang;
  modelSnapshot: AnalysisModelSnapshot;
  // The runner mints the row before any stage runs, so usage starts at zero
  // and is accumulated as stages complete; callers may seed a value.
  usage?: AnalysisUsage;
  // Defaults to "generating"; tests/callers may seed a terminal state.
  status?: AnalysisStatus;
};

const ZERO_USAGE: AnalysisUsage = { inputTokens: 0, outputTokens: 0 };

export async function createAnalysis(
  input: CreateAnalysisInput,
): Promise<ArticleAnalysisRecord> {
  const now = Date.now();
  const record: ArticleAnalysisRecord = {
    id: newId("ana"),
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    title: input.title,
    targetLang: input.targetLang,
    status: input.status ?? "generating",
    modelSnapshot: input.modelSnapshot,
    usage: input.usage ?? ZERO_USAGE,
    createdAt: now,
    updatedAt: now,
  };
  await db.articleAnalyses.add(record);
  return record;
}

export async function getAnalysis(
  id: string,
): Promise<ArticleAnalysisRecord | undefined> {
  return db.articleAnalyses.get(id);
}

export async function listAnalysesByWorkspace(
  workspaceId: string,
): Promise<ArticleAnalysisRecord[]> {
  const rows = await db.articleAnalyses
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listAnalysesBySource(
  sourceId: string,
): Promise<ArticleAnalysisRecord[]> {
  const rows = await db.articleAnalyses
    .where("sourceId")
    .equals(sourceId)
    .toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export type AnalysisPatch = Partial<{
  title: string;
  status: AnalysisStatus;
  modelSnapshot: AnalysisModelSnapshot;
  usage: AnalysisUsage;
  // `null` is the explicit-clear signal (translated to undefined → Dexie
  // drops the field rather than storing a JSON null).
  payload: ArticleAnalysisPayload | null;
  brief: ArticleBrief | null;
  briefChat: BriefChatMessage[];
  briefRevisions: BriefRevision[];
  fallbackReason: string | null;
  errorMessage: string | null;
}>;

export async function updateAnalysis(
  id: string,
  patch: AnalysisPatch,
): Promise<void> {
  const next: Record<string, unknown> = { updatedAt: Date.now() };
  for (const [key, value] of Object.entries(patch)) {
    // Explicit null clears the field; mirror updateRoadmap's null→undefined
    // translation so Dexie removes it instead of persisting a JSON null.
    next[key] = value === null ? undefined : value;
  }
  await db.articleAnalyses.update(id, next);
}

// Convenience for the pipeline runner to flip generating → ready/draft/error
// while writing the payload / merged usage / degradation reason in one stamp.
export type AnalysisStatusExtra = {
  payload?: ArticleAnalysisPayload | null;
  brief?: ArticleBrief | null;
  usage?: AnalysisUsage;
  fallbackReason?: string | null;
  errorMessage?: string | null;
};

export async function setAnalysisStatus(
  id: string,
  status: AnalysisStatus,
  extra?: AnalysisStatusExtra,
): Promise<void> {
  await updateAnalysis(id, {
    status,
    ...(extra?.payload !== undefined ? { payload: extra.payload } : {}),
    ...(extra?.brief !== undefined ? { brief: extra.brief } : {}),
    ...(extra?.usage !== undefined ? { usage: extra.usage } : {}),
    ...(extra?.fallbackReason !== undefined
      ? { fallbackReason: extra.fallbackReason }
      : {}),
    ...(extra?.errorMessage !== undefined
      ? { errorMessage: extra.errorMessage }
      : {}),
  });
}

export async function deleteAnalysis(id: string): Promise<void> {
  await db.articleAnalyses.delete(id);
}

export async function appendBriefChat(id: string, message: BriefChatMessage): Promise<void> {
  await db.transaction("rw", db.articleAnalyses, async () => {
    const record = await db.articleAnalyses.get(id);
    if (!record) throw new Error("Analysis not found");
    await db.articleAnalyses.update(id, {
      briefChat: [...(record.briefChat ?? []), message],
      updatedAt: Date.now(),
    });
  });
}

export async function applyBriefRevision(id: string, next: BriefSection): Promise<void> {
  await db.transaction("rw", db.articleAnalyses, async () => {
    const record = await db.articleAnalyses.get(id);
    if (!record?.brief) throw new Error("Editable brief not found");
    const previous = record.brief.sections.find((section) => section.id === next.id);
    if (!previous || previous.kind !== next.kind) throw new Error("Section mismatch");
    const brief: ArticleBrief = {
      ...record.brief,
      sections: record.brief.sections.map((section) => section.id === next.id ? next : section),
    };
    const revision: BriefRevision = {
      id: newId("rev"),
      sectionId: next.id,
      previous,
      next,
      createdAt: Date.now(),
    };
    await db.articleAnalyses.update(id, {
      brief,
      payload: projectBriefToLegacy(brief),
      briefRevisions: [...(record.briefRevisions ?? []), revision],
      updatedAt: Date.now(),
    });
  });
}

export async function undoBriefRevision(id: string, sectionId: string): Promise<void> {
  await db.transaction("rw", db.articleAnalyses, async () => {
    const record = await db.articleAnalyses.get(id);
    if (!record?.brief) throw new Error("Editable brief not found");
    const revisions = record.briefRevisions ?? [];
    const index = revisions.findLastIndex((revision) => revision.sectionId === sectionId);
    if (index < 0) return;
    const previous = revisions[index]!.previous;
    const brief: ArticleBrief = {
      ...record.brief,
      sections: previous
        ? record.brief.sections.map((section) => section.id === sectionId ? previous : section)
        : record.brief.sections.filter((section) => section.id !== sectionId),
    };
    await db.articleAnalyses.update(id, {
      brief,
      payload: projectBriefToLegacy(brief),
      briefRevisions: revisions.filter((_, i) => i !== index),
      updatedAt: Date.now(),
    });
  });
}

export async function appendExternalNote(
  id: string,
  text: string,
  sources: { title: string; url: string }[],
  focusedSectionId?: string,
): Promise<void> {
  await db.transaction("rw", db.articleAnalyses, async () => {
    const record = await db.articleAnalyses.get(id);
    if (!record?.brief) throw new Error("Editable brief not found");
    const sectionId = newId("research");
    const safeSources = sources.filter((source) => /^https?:\/\//i.test(source.url));
    const externalBlock = {
      id: `${sectionId}-0`,
      kind: "external" as const,
      text,
      grounding: "external" as const,
      externalSources: safeSources,
    };
    const focused = record.brief.sections.find((section) => section.id === focusedSectionId);
    if (focused) {
      const next: BriefSection = { ...focused, blocks: [...focused.blocks, externalBlock] };
      const brief: ArticleBrief = {
        ...record.brief,
        sections: record.brief.sections.map((section) => section.id === focused.id ? next : section),
      };
      const revision: BriefRevision = {
        id: newId("rev"), sectionId: focused.id, previous: focused, next, createdAt: Date.now(),
      };
      await db.articleAnalyses.update(id, {
        brief,
        briefRevisions: [...(record.briefRevisions ?? []), revision],
        updatedAt: Date.now(),
      });
      return;
    }
    const brief: ArticleBrief = {
      ...record.brief,
      sections: [...record.brief.sections, {
        id: sectionId,
        kind: "external",
        title: record.targetLang === "tr" ? "Ek araştırma" : "Further research",
        blocks: [externalBlock],
      }],
    };
    const next = brief.sections[brief.sections.length - 1]!;
    const revision: BriefRevision = {
      id: newId("rev"), sectionId, next, createdAt: Date.now(),
    };
    await db.articleAnalyses.update(id, {
      brief,
      briefRevisions: [...(record.briefRevisions ?? []), revision],
      updatedAt: Date.now(),
    });
  });
}
