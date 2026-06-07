import { newId } from "@/lib/utils/id";
import { db } from "./schema";
import type { SourceRecord } from "./types";
import type {
  AiUsageRecord,
  CurriculumItemRecord,
  CurriculumItemStatus,
  CurriculumRecord,
  CurriculumStatus,
  LessonNoteRecord,
  LessonNoteStatus,
  StudyJournalEntryRecord,
  StudySourceRef,
} from "@/lib/study/types";

export type CreateCurriculumItemInput = {
  parentId?: string | undefined;
  title: string;
  objective: string;
  sourceRefs: StudySourceRef[];
  prerequisites: string[];
  estimatedMinutes: number;
  status?: CurriculumItemStatus | undefined;
};

export type CreateCurriculumInput = {
  workspaceId: string;
  title: string;
  goal?: string | undefined;
  level?: string | undefined;
  sourceIds: string[];
  status?: CurriculumStatus | undefined;
  items: CreateCurriculumItemInput[];
};

export async function createCurriculum(
  input: CreateCurriculumInput,
): Promise<{ curriculum: CurriculumRecord; items: CurriculumItemRecord[] }> {
  const now = Date.now();
  const curriculum: CurriculumRecord = {
    id: newId("cur"),
    workspaceId: input.workspaceId,
    title: input.title,
    sourceIds: input.sourceIds,
    status: input.status ?? "draft",
    createdAt: now,
    updatedAt: now,
  };
  if (input.goal) curriculum.goal = input.goal;
  if (input.level) curriculum.level = input.level;

  const items: CurriculumItemRecord[] = input.items.map((item, order) => {
    const record: CurriculumItemRecord = {
      id: newId("curi"),
      workspaceId: input.workspaceId,
      curriculumId: curriculum.id,
      order,
      title: item.title,
      objective: item.objective,
      sourceRefs: item.sourceRefs,
      prerequisites: item.prerequisites,
      status: item.status ?? "not_started",
      estimatedMinutes: item.estimatedMinutes,
      createdAt: now,
      updatedAt: now,
    };
    if (item.parentId) record.parentId = item.parentId;
    return record;
  });

  await db.transaction("rw", [db.curricula, db.curriculumItems], async () => {
    await db.curricula.add(curriculum);
    if (items.length > 0) await db.curriculumItems.bulkAdd(items);
  });

  return { curriculum, items };
}

export async function getCurriculum(
  id: string,
): Promise<CurriculumRecord | undefined> {
  return db.curricula.get(id);
}

export async function listCurriculaByWorkspace(
  workspaceId: string,
): Promise<CurriculumRecord[]> {
  const rows = await db.curricula
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listCurriculumItems(
  curriculumId: string,
): Promise<CurriculumItemRecord[]> {
  const rows = await db.curriculumItems
    .where("curriculumId")
    .equals(curriculumId)
    .toArray();
  return rows.sort((a, b) => a.order - b.order);
}

export async function getCurriculumItem(
  id: string,
): Promise<CurriculumItemRecord | undefined> {
  return db.curriculumItems.get(id);
}

export async function setCurriculumItemStatus(
  id: string,
  status: CurriculumItemStatus,
): Promise<void> {
  await db.curriculumItems.update(id, { status, updatedAt: Date.now() });
}

export type CreateLessonNoteInput = {
  workspaceId: string;
  curriculumItemId: string;
  title: string;
  contentMarkdown: string;
  sourceRefs: StudySourceRef[];
  generationPromptVersion: string;
  modelId: string;
  usage?: AiUsageRecord | undefined;
  status?: LessonNoteStatus | undefined;
};

export async function createLessonNote(
  input: CreateLessonNoteInput,
): Promise<LessonNoteRecord> {
  const now = Date.now();
  const record: LessonNoteRecord = {
    id: newId("les"),
    workspaceId: input.workspaceId,
    curriculumItemId: input.curriculumItemId,
    title: input.title,
    format: "markdown",
    contentMarkdown: input.contentMarkdown,
    sourceRefs: input.sourceRefs,
    generationPromptVersion: input.generationPromptVersion,
    modelId: input.modelId,
    status: input.status ?? "draft",
    createdAt: now,
    updatedAt: now,
  };
  if (input.usage) record.usage = input.usage;
  await db.lessonNotes.add(record);
  return record;
}

export async function getLessonNote(
  id: string,
): Promise<LessonNoteRecord | undefined> {
  return db.lessonNotes.get(id);
}

export type UpdateLessonNoteInput = {
  title?: string | undefined;
  contentMarkdown?: string | undefined;
  sourceRefs?: StudySourceRef[] | undefined;
  generationPromptVersion?: string | undefined;
  modelId?: string | undefined;
  usage?: AiUsageRecord | undefined;
  status?: LessonNoteStatus | undefined;
};

/**
 * Patch a lesson note in place. Always advances `updatedAt`. Used by the
 * editor autosave (contentMarkdown only) and AI regenerate (full overwrite).
 */
export async function updateLessonNote(
  id: string,
  patch: UpdateLessonNoteInput,
): Promise<void> {
  const update: Partial<LessonNoteRecord> = { updatedAt: Date.now() };
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.contentMarkdown !== undefined)
    update.contentMarkdown = patch.contentMarkdown;
  if (patch.sourceRefs !== undefined) update.sourceRefs = patch.sourceRefs;
  if (patch.generationPromptVersion !== undefined)
    update.generationPromptVersion = patch.generationPromptVersion;
  if (patch.modelId !== undefined) update.modelId = patch.modelId;
  if (patch.usage !== undefined) update.usage = patch.usage;
  if (patch.status !== undefined) update.status = patch.status;
  await db.lessonNotes.update(id, update);
}

export async function listLessonNotesByWorkspace(
  workspaceId: string,
): Promise<LessonNoteRecord[]> {
  const rows = await db.lessonNotes
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listLessonNotesByItem(
  curriculumItemId: string,
): Promise<LessonNoteRecord[]> {
  const rows = await db.lessonNotes
    .where("curriculumItemId")
    .equals(curriculumItemId)
    .toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export type CreateStudyJournalEntryInput = {
  workspaceId: string;
  lessonNoteId?: string | undefined;
  sourceId?: string | undefined;
  question: string;
  answerMarkdown: string;
  sourceRefs: StudySourceRef[];
  tags: string[];
};

export async function createStudyJournalEntry(
  input: CreateStudyJournalEntryInput,
): Promise<StudyJournalEntryRecord> {
  const record: StudyJournalEntryRecord = {
    id: newId("sj"),
    workspaceId: input.workspaceId,
    question: input.question,
    answerMarkdown: input.answerMarkdown,
    sourceRefs: input.sourceRefs,
    tags: input.tags,
    createdAt: Date.now(),
  };
  if (input.lessonNoteId) record.lessonNoteId = input.lessonNoteId;
  if (input.sourceId) record.sourceId = input.sourceId;
  await db.studyJournalEntries.add(record);
  return record;
}

export async function listStudyJournalEntries(
  workspaceId: string,
): Promise<StudyJournalEntryRecord[]> {
  const rows = await db.studyJournalEntries
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteStudyJournalEntry(id: string): Promise<void> {
  await db.studyJournalEntries.delete(id);
}

export async function createDraftCurriculumForWorkspace(
  workspaceId: string,
  opts: { sourceIds?: string[] | undefined } = {},
): Promise<{ curriculum: CurriculumRecord; items: CurriculumItemRecord[] }> {
  const workspace = await db.workspaces.get(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }
  const sources = await db.sources
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  const selectedSourceIds =
    opts.sourceIds && opts.sourceIds.length > 0
      ? new Set(opts.sourceIds)
      : undefined;
  const readySources = sources
    .filter(
      (source) =>
        source.ingestStatus === "ready" &&
        (!selectedSourceIds || selectedSourceIds.has(source.id)),
    )
    .sort((a, b) => a.createdAt - b.createdAt);
  if (readySources.length === 0) {
    throw new Error("draft-curriculum: no ready sources");
  }
  const sourceIds = readySources.map((source) => source.id);
  const chunks = await db.chunks
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  const chunksBySource = new Map<string, typeof chunks>();
  for (const chunk of chunks.sort((a, b) => a.index - b.index)) {
    const bucket = chunksBySource.get(chunk.sourceId) ?? [];
    bucket.push(chunk);
    chunksBySource.set(chunk.sourceId, bucket);
  }

  const items: CreateCurriculumItemInput[] = [];
  const seenTitles = new Set<string>();
  for (const source of readySources) {
    const sourceChunks = chunksBySource.get(source.id) ?? [];
    for (const chunk of sourceChunks) {
      if (items.length >= 8) break;
      const title = titleForChunk(source, chunk.section ?? chunk.headings?.[0]);
      const titleKey = title.toLowerCase();
      if (seenTitles.has(titleKey)) continue;
      seenTitles.add(titleKey);
      items.push({
        title,
        objective: `Study ${title} from ${source.title}.`,
        sourceRefs: [
          {
            sourceId: source.id,
            chunkIds: [chunk.id],
            ...(chunk.section ? { section: chunk.section } : {}),
          },
        ],
        prerequisites: items.length > 0 ? [items[items.length - 1]!.title] : [],
        estimatedMinutes: estimateMinutes(chunk.tokenCount),
      });
    }
  }
  if (items.length === 0) {
    throw new Error("draft-curriculum: no chunks in ready sources");
  }

  return createCurriculum({
    workspaceId,
    title: `${workspace.name} curriculum`,
    goal: workspace.goal,
    sourceIds,
    status: "draft",
    items,
  });
}

function titleForChunk(source: SourceRecord, section: string | undefined): string {
  const trimmed = section?.trim();
  if (trimmed) return trimmed;
  return source.title.replace(/\.[^.]+$/, "");
}

function estimateMinutes(tokenCount: number): number {
  if (!Number.isFinite(tokenCount) || tokenCount <= 0) return 25;
  return Math.max(15, Math.min(90, Math.round(tokenCount / 25) * 5));
}

export async function createDraftLessonNoteForItem(
  curriculumItemId: string,
): Promise<LessonNoteRecord> {
  const existing = await db.lessonNotes
    .where("curriculumItemId")
    .equals(curriculumItemId)
    .first();
  if (existing) return existing;

  const item = await db.curriculumItems.get(curriculumItemId);
  if (!item) {
    throw new Error(`Curriculum item not found: ${curriculumItemId}`);
  }
  const refs = item.sourceRefs;
  if (refs.length === 0) {
    throw new Error("draft-lesson-note: item has no source refs");
  }

  const chunkIds = refs.flatMap((ref) => ref.chunkIds ?? []);
  const chunks = chunkIds.length > 0 ? await db.chunks.bulkGet(chunkIds) : [];
  const chunksById = new Map(
    chunks
      .filter((chunk): chunk is NonNullable<(typeof chunks)[number]> => chunk !== undefined)
      .map((chunk) => [chunk.id, chunk]),
  );
  const sections = refs
    .map((ref) => ref.section)
    .filter((section): section is string => typeof section === "string" && section.length > 0);
  const sourceTitles = await db.sources
    .bulkGet(Array.from(new Set(refs.map((ref) => ref.sourceId))))
    .then((sources) =>
      sources
        .filter((source): source is NonNullable<(typeof sources)[number]> => source !== undefined)
        .map((source) => source.title),
    );

  const primaryFocus = sections[0] ?? sourceTitles[0] ?? item.title;
  const body: string[] = [
    `# ${item.title}`,
    "",
    "## Goal",
    "",
    item.objective,
    "",
    "## What to learn",
    "",
    `- Define what **${item.title}** means in this source.`,
    `- Explain the main problem or tradeoff behind **${primaryFocus}**.`,
    "- Connect the source passage to the topic in your own words.",
    "- Create at least one recall question after reading.",
  ];
  body.push("", "## Key passages", "");
  for (const ref of refs) {
    const ids = ref.chunkIds ?? [];
    if (ids.length === 0) {
      body.push(`- Source ${ref.sourceId}`);
      continue;
    }
    for (const id of ids) {
      const chunk = chunksById.get(id);
      const preview = chunk ? firstSentence(chunk.text) : "Referenced passage";
      body.push(`- ${preview} [§${id}]`);
    }
  }
  body.push(
    "",
    "## Check yourself",
    "",
    `- What is the core idea of **${item.title}**?`,
    `- Why does **${primaryFocus}** matter here?`,
    "- Which part of the source passage supports your explanation?",
    "",
    "## Recap",
    "",
    `Study this topic until you can explain: ${item.objective}`,
  );

  return createLessonNote({
    workspaceId: item.workspaceId,
    curriculumItemId: item.id,
    title: item.title,
    contentMarkdown: body.join("\n"),
    sourceRefs: refs,
    generationPromptVersion: "deterministic-draft-v1",
    modelId: "local-draft",
    status: "ready",
  });
}

function firstSentence(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 180) return compact;
  const sentenceEnd = compact.slice(0, 180).search(/[.!?]\s/);
  if (sentenceEnd > 40) return compact.slice(0, sentenceEnd + 1);
  return `${compact.slice(0, 177)}...`;
}
