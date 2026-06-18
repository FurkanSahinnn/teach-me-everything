// Workspace Chat — Performans context builder.
//
// Surfaces the learner's weak spots so the tutor can target them: the
// flashcards with the poorest SM-2 health (leeches, low success ratio, high
// lapses) and the recent quiz items the user got wrong. Reads the flashcards
// and quiz-sessions repos; returns null when there is no study activity yet.

import { listFlashcardsByWorkspace } from "@/lib/db/flashcards";
import { listQuizSessionsByWorkspace } from "@/lib/db/quiz-sessions";
import type { FlashcardRecord } from "@/lib/db/types";
import type { QuizSessionRecord } from "@/lib/quiz/types";
import { CONTEXT_TOKEN_BUDGETS, clampToBudget } from "./budget";
import type { ContextBlock } from "./types";

const MAX_WEAK_CARDS = 15;
const MAX_QUIZ_MISSES = 12;
const RECENT_QUIZ_SESSIONS = 10;
const QUESTION_CHARS = 140;

// A "weak" card is one the learner is struggling with: a flagged leech, or a
// card that has been reviewed at least twice with a success ratio under 60%,
// or one that has lapsed at least twice. Cards never reviewed are excluded —
// they are unknown, not weak.
function weaknessScore(card: FlashcardRecord): number {
  if (card.reviewCount === 0) return 0;
  const failures = card.reviewCount - card.successCount;
  const failRatio = failures / card.reviewCount;
  const lapses = card.lapses ?? 0;
  // Higher = weaker. Leech dominates, then fail ratio, then raw lapse count.
  return (card.leech ? 100 : 0) + failRatio * 50 + lapses;
}

function isWeak(card: FlashcardRecord): boolean {
  if (card.reviewCount === 0) return false;
  if (card.leech) return true;
  const failures = card.reviewCount - card.successCount;
  const failRatio = failures / card.reviewCount;
  if (card.reviewCount >= 2 && failRatio >= 0.4) return true;
  if ((card.lapses ?? 0) >= 2) return true;
  return false;
}

function buildWeakCardLines(cards: FlashcardRecord[]): string[] {
  const weak = cards
    .filter(isWeak)
    .sort((a, b) => weaknessScore(b) - weaknessScore(a))
    .slice(0, MAX_WEAK_CARDS);
  if (weak.length === 0) return [];
  const lines = ["Weakest flashcards (struggling — prioritize these):"];
  for (const card of weak) {
    const q = card.question.replace(/\s+/g, " ").trim().slice(0, QUESTION_CHARS);
    const failures = card.reviewCount - card.successCount;
    const flag = card.leech ? " [leech]" : "";
    lines.push(`- ${q} (${failures}/${card.reviewCount} failed${flag})`);
  }
  return lines;
}

function buildQuizMissLines(sessions: QuizSessionRecord[]): string[] {
  const misses: string[] = [];
  // Newest sessions first (the repo already sorts that way); walk until we have
  // enough distinct missed questions.
  for (const session of sessions.slice(0, RECENT_QUIZ_SESSIONS)) {
    for (const answer of session.answers) {
      if (misses.length >= MAX_QUIZ_MISSES) break;
      if (answer.correct === false) {
        const item = session.items[answer.itemIndex];
        if (!item) continue;
        const q = item.q.replace(/\s+/g, " ").trim().slice(0, QUESTION_CHARS);
        if (q.length > 0) misses.push(`- ${q}`);
      }
    }
    if (misses.length >= MAX_QUIZ_MISSES) break;
  }
  if (misses.length === 0) return [];
  return ["Recently missed quiz questions:", ...misses];
}

export async function buildPerformanceContext(
  workspaceId: string,
): Promise<ContextBlock | null> {
  const [cards, sessions] = await Promise.all([
    listFlashcardsByWorkspace(workspaceId),
    listQuizSessionsByWorkspace(workspaceId),
  ]);

  const weakCardLines = buildWeakCardLines(cards);
  const quizMissLines = buildQuizMissLines(sessions);
  if (weakCardLines.length === 0 && quizMissLines.length === 0) return null;

  const sections: string[] = ["Learner performance summary."];
  if (weakCardLines.length > 0) sections.push("", ...weakCardLines);
  if (quizMissLines.length > 0) sections.push("", ...quizMissLines);

  const text = clampToBudget(
    sections.join("\n"),
    CONTEXT_TOKEN_BUDGETS.performance,
  );
  if (text.trim().length === 0) return null;
  return { kind: "performance", text };
}
