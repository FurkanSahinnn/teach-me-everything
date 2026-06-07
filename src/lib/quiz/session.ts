// Pure quiz session reducer. The page renders + persists state but never
// mutates it directly — every transition runs through one of these fns
// so the test suite can pin behaviour without spinning up React or Dexie.
//
// 4.C ships MCQ-only behaviour. Open items (4.D) live in the same shape
// because the eval prompt needs to write back `correct` + `feedback` after
// a network round-trip; making the helpers union-aware now means 4.D adds
// only the eval call, no signature churn.

import type {
  QuizAnswer,
  QuizItem,
  QuizMcqAnswer,
  QuizMcqItem,
  QuizOpenAnswer,
  QuizOpenItem,
  QuizSessionRecord,
} from "./types";

// Session state isn't a separate type because the reducer operates on the
// persistence record itself — the page reads/writes Dexie via the same
// shape the LLM produced.
export type SessionState = Pick<
  QuizSessionRecord,
  "items" | "answers" | "startedAt" | "finishedAt" | "score"
>;

export function isSessionFinished(s: Pick<SessionState, "finishedAt">): boolean {
  return typeof s.finishedAt === "number";
}

export function answerForIndex(
  s: Pick<SessionState, "answers">,
  itemIndex: number,
): QuizAnswer | undefined {
  return s.answers.find((a) => a.itemIndex === itemIndex);
}

/**
 * Record a user response for the item at `itemIndex`. MCQ resolves
 * correctness immediately; open items mark `correct: null` until the AI
 * eval call (4.D) writes the verdict back via `applyOpenEval`.
 *
 * Idempotent on the same `(itemIndex, choice)`: re-submitting overwrites
 * the previous answer rather than appending — matches the UX where the
 * user can change their selection before moving on.
 */
export function submitAnswer(
  state: SessionState,
  itemIndex: number,
  response:
    | { kind: "mcq"; selectedIndex: number | null }
    | { kind: "open"; text: string },
  now: number = Date.now(),
): SessionState {
  const item = state.items[itemIndex];
  if (!item) return state;
  if (item.kind !== response.kind) return state;

  let next: QuizAnswer;
  if (item.kind === "mcq" && response.kind === "mcq") {
    const correct =
      response.selectedIndex !== null &&
      response.selectedIndex === item.correctIndex;
    next = {
      kind: "mcq",
      itemIndex,
      selectedIndex: response.selectedIndex,
      correct,
      answeredAt: now,
    } satisfies QuizMcqAnswer;
  } else {
    next = {
      kind: "open",
      itemIndex,
      text: (response as { text: string }).text,
      correct: null,
      answeredAt: now,
    } satisfies QuizOpenAnswer;
  }

  const without = state.answers.filter((a) => a.itemIndex !== itemIndex);
  // Keep answers in itemIndex order so summary/score iteration is
  // deterministic regardless of the user's traversal pattern.
  const answers = [...without, next].sort((a, b) => a.itemIndex - b.itemIndex);
  return { ...state, answers };
}

/**
 * Patch an open-item answer with the result of the rubric evaluator (4.D).
 * No-op when the item isn't open or no answer exists yet.
 */
export function applyOpenEval(
  state: SessionState,
  itemIndex: number,
  result: { correct: boolean; feedback?: string },
): SessionState {
  const existing = answerForIndex(state, itemIndex);
  if (!existing || existing.kind !== "open") return state;
  const updated: QuizOpenAnswer = {
    ...existing,
    correct: result.correct,
    ...(result.feedback !== undefined ? { feedback: result.feedback } : {}),
  };
  const answers = state.answers.map((a) =>
    a.itemIndex === itemIndex ? updated : a,
  );
  return { ...state, answers };
}

/**
 * Find the next item the user hasn't answered yet, walking forward from
 * `fromIndex`. Returns the index, or null when every item has an answer.
 */
export function nextItem(
  state: Pick<SessionState, "items" | "answers">,
  fromIndex: number,
): number | null {
  const answered = new Set(state.answers.map((a) => a.itemIndex));
  for (let i = fromIndex; i < state.items.length; i += 1) {
    if (!answered.has(i)) return i;
  }
  for (let i = 0; i < fromIndex; i += 1) {
    if (!answered.has(i)) return i;
  }
  return null;
}

/**
 * Compute the running score as `correct / total`. Open items pending eval
 * (`correct === null`) count as incorrect for the running tally — the UI
 * can re-render once eval lands and the value flips.
 */
export function computeScore(
  state: Pick<SessionState, "items" | "answers">,
): number {
  const total = state.items.length;
  if (total === 0) return 0;
  let correct = 0;
  for (const a of state.answers) {
    if (a.kind === "mcq" && a.correct) correct += 1;
    else if (a.kind === "open" && a.correct === true) correct += 1;
  }
  return correct / total;
}

/**
 * Mark the session finished, freezing the score so the summary view doesn't
 * recompute on every render. Pass through `Date.now()` when finalizing
 * client-side; tests inject a fixed `now`.
 */
export function finishSession(
  state: SessionState,
  now: number = Date.now(),
): SessionState {
  return {
    ...state,
    finishedAt: now,
    score: computeScore(state),
  };
}

// Helper: build the rubric the 4.D evaluator will score against. Pure so
// the prompt stays declarative — the rubric is just a literal field on the
// item, but split out so callers don't have to discriminate.
export function rubricFor(item: QuizItem): string | undefined {
  if (item.kind !== "open") return undefined;
  return (item satisfies QuizOpenItem).rubric;
}

// Helper: list MCQ-only items, useful when the UI wants a separate stat.
export function mcqItems(items: QuizItem[]): QuizMcqItem[] {
  return items.filter((i): i is QuizMcqItem => i.kind === "mcq");
}
