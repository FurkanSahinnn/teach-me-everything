export type CurriculumStatus = "draft" | "active" | "archived";

export type CurriculumItemStatus =
  | "not_started"
  | "active"
  | "done"
  | "skipped";

export type LessonNoteStatus = "draft" | "ready" | "archived";

export type StudySourceRef = {
  sourceId: string;
  chunkIds?: string[] | undefined;
  section?: string | undefined;
  quote?: string | undefined;
};

export type AiUsageRecord = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cacheReadTokens?: number | undefined;
  cacheCreationTokens?: number | undefined;
};

export type CurriculumRecord = {
  id: string;
  workspaceId: string;
  title: string;
  goal?: string | undefined;
  level?: string | undefined;
  sourceIds: string[];
  status: CurriculumStatus;
  createdAt: number;
  updatedAt: number;
};

export type CurriculumItemRecord = {
  id: string;
  workspaceId: string;
  curriculumId: string;
  parentId?: string | undefined;
  order: number;
  title: string;
  objective: string;
  sourceRefs: StudySourceRef[];
  prerequisites: string[];
  status: CurriculumItemStatus;
  estimatedMinutes: number;
  createdAt: number;
  updatedAt: number;
};

export type LessonNoteRecord = {
  id: string;
  workspaceId: string;
  curriculumItemId: string;
  title: string;
  format: "markdown";
  contentMarkdown: string;
  sourceRefs: StudySourceRef[];
  generationPromptVersion: string;
  modelId: string;
  usage?: AiUsageRecord | undefined;
  status: LessonNoteStatus;
  createdAt: number;
  updatedAt: number;
};

export type StudyJournalEntryRecord = {
  id: string;
  workspaceId: string;
  lessonNoteId?: string | undefined;
  sourceId?: string | undefined;
  question: string;
  answerMarkdown: string;
  sourceRefs: StudySourceRef[];
  tags: string[];
  createdAt: number;
};
