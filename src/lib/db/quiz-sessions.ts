import { newId } from "@/lib/utils/id";
import { db } from "./schema";
import type { ContentLangMode } from "@/lib/ai/content-language";
import type {
  QuizAnswer,
  QuizItem,
  QuizSessionRecord,
} from "@/lib/quiz/types";

export type CreateQuizSessionInput = {
  workspaceId: string;
  sourceId?: string;
  items: QuizItem[];
  model?: string;
  langMode?: ContentLangMode;
};

export async function createQuizSession(
  input: CreateQuizSessionInput,
): Promise<QuizSessionRecord> {
  const now = Date.now();
  const record: QuizSessionRecord = {
    id: newId("quiz"),
    workspaceId: input.workspaceId,
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    items: input.items,
    answers: [],
    startedAt: now,
    ...(input.model ? { model: input.model } : {}),
    ...(input.langMode ? { langMode: input.langMode } : {}),
  };
  await db.quizSessions.add(record);
  return record;
}

export async function getQuizSession(
  id: string,
): Promise<QuizSessionRecord | undefined> {
  return db.quizSessions.get(id);
}

/**
 * Replace the answers array on the session row. Idempotent — the caller
 * always passes the full new array so we don't have to merge.
 */
export async function patchQuizAnswers(
  id: string,
  answers: QuizAnswer[],
): Promise<void> {
  await db.quizSessions.update(id, { answers });
}

/**
 * Mark a session finished, persisting the cached score so the summary view
 * doesn't have to recompute. Use the `finishSession` reducer in
 * `lib/quiz/session.ts` to derive the values, then pass them in.
 */
export async function finishQuizSession(
  id: string,
  args: { finishedAt: number; score: number; answers: QuizAnswer[] },
): Promise<void> {
  await db.quizSessions.update(id, {
    finishedAt: args.finishedAt,
    score: args.score,
    answers: args.answers,
  });
}

export async function listQuizSessionsByWorkspace(
  workspaceId: string,
  limit: number = 50,
): Promise<QuizSessionRecord[]> {
  const items = await db.quizSessions
    .where("[workspaceId+startedAt]")
    .between([workspaceId, 0], [workspaceId, Number.MAX_SAFE_INTEGER], true, true)
    .toArray();
  return items.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

export async function deleteQuizSession(id: string): Promise<void> {
  await db.quizSessions.delete(id);
}
