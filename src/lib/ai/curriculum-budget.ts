export const CURRICULUM_CHUNK_DETAIL_MIN = 1;
export const CURRICULUM_CHUNK_DETAIL_MAX = 5;
export const DEFAULT_CURRICULUM_CHUNK_DETAIL = 3;

export type CurriculumChunkDetailLevel = 1 | 2 | 3 | 4 | 5;

type CurriculumPromptBudget = {
  sourceTextBudgetChars: number;
  maxChunkTextChars: number;
};

const CURRICULUM_PROMPT_BUDGETS: Record<
  CurriculumChunkDetailLevel,
  CurriculumPromptBudget
> = {
  1: { sourceTextBudgetChars: 40_000, maxChunkTextChars: 1_500 },
  2: { sourceTextBudgetChars: 80_000, maxChunkTextChars: 2_500 },
  3: { sourceTextBudgetChars: 120_000, maxChunkTextChars: 4_000 },
  4: { sourceTextBudgetChars: 160_000, maxChunkTextChars: 6_000 },
  5: { sourceTextBudgetChars: 200_000, maxChunkTextChars: 8_000 },
};

export function clampCurriculumChunkDetail(
  value: number,
): CurriculumChunkDetailLevel {
  if (!Number.isFinite(value)) return DEFAULT_CURRICULUM_CHUNK_DETAIL;
  const rounded = Math.round(value);
  if (rounded <= CURRICULUM_CHUNK_DETAIL_MIN) return 1;
  if (rounded >= CURRICULUM_CHUNK_DETAIL_MAX) return 5;
  return rounded as CurriculumChunkDetailLevel;
}

export function getCurriculumPromptBudget(
  level: CurriculumChunkDetailLevel,
): CurriculumPromptBudget {
  return CURRICULUM_PROMPT_BUDGETS[level];
}
