import type { ContentLangMode } from "@/lib/ai/content-language";

// Discriminated union so the UI can switch render paths off `kind` while
// the persistence layer stores the same shape used by the LLM. `open` items
// land in 4.D (rubric-based evaluation); 4.C only generates and renders
// `mcq` items, but keeping both literals here keeps the storage schema
// stable across phases.

export type QuizMcqItem = {
  kind: "mcq";
  q: string;
  /** Always exactly 4 choices. The parser drops items that do not
   *  satisfy this invariant rather than auto-padding. */
  choices: string[];
  /** Index into `choices` of the single correct answer. Always in [0, 3]. */
  correctIndex: number;
  /** Optional explanation surfaced after the user answers. */
  explanation?: string | undefined;
  sourceSection?: string | undefined;
  sourceChunkId?: string | undefined;
  /** English siblings, populated only for "both"-language sessions. `qEn` and
   *  `explanationEn` mirror their base fields; `choicesEn` is index-aligned
   *  with `choices` so `correctIndex` (shared) stays valid for either view. */
  qEn?: string | undefined;
  choicesEn?: string[] | undefined;
  explanationEn?: string | undefined;
};

export type QuizOpenItem = {
  kind: "open";
  q: string;
  /** Free-form rubric the eval prompt (4.D) scores the user's answer
   *  against. Required so we never have to guess what "correct" means. */
  rubric: string;
  sourceSection?: string | undefined;
  sourceChunkId?: string | undefined;
  /** English siblings, populated only for "both"-language sessions. */
  qEn?: string | undefined;
  rubricEn?: string | undefined;
};

export type QuizItem = QuizMcqItem | QuizOpenItem;

// Per-item user response. For MCQ this is the chosen choice index; for
// open items the literal text the user typed. `correct` is the resolved
// correctness — set by the session reducer for MCQ on submit, set by the
// 4.D rubric evaluator for open items.
export type QuizMcqAnswer = {
  kind: "mcq";
  itemIndex: number;
  /** The user's selected choice index in [0, 3], or null when skipped. */
  selectedIndex: number | null;
  correct: boolean;
  answeredAt: number;
};

export type QuizOpenAnswer = {
  kind: "open";
  itemIndex: number;
  text: string;
  /** `null` while awaiting AI eval (4.D); `true`/`false` once scored. */
  correct: boolean | null;
  feedback?: string | undefined;
  answeredAt: number;
};

export type QuizAnswer = QuizMcqAnswer | QuizOpenAnswer;

// Persistence shape. Items are stored inline because they are
// session-scoped (regenerated each run) and not queryable in isolation.
export type QuizSessionRecord = {
  id: string;
  workspaceId: string;
  sourceId?: string | undefined;
  items: QuizItem[];
  answers: QuizAnswer[];
  startedAt: number;
  finishedAt?: number | undefined;
  /** Cached score (0..1) once the session is finished. Null/undefined while
   *  in progress so callers know to recompute. */
  score?: number | undefined;
  /** Model that produced the items — provenance, surfaced in summary. */
  model?: string | undefined;
  /** Content-language mode captured at generation time. Only `"both"` gates
   *  the per-view TR/EN render toggle (items carry parallel `*En` fields). */
  langMode?: ContentLangMode | undefined;
};
