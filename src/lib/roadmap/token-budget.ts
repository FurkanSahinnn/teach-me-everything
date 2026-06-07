import type { RoadmapTimeframe } from "./types";

// Maps the wizard's Daily / Weekly / Monthly chip onto the size hint the AI
// prompt prepends ("target between {min} and {max} nodes"). Three buckets
// matches the decision locked in docs/ROADMAP_FEATURE_SPEC.md §2 row 3 —
// keep the lower bound non-zero so an empty graph never ships, and the
// upper bound bounded so the JSON output token budget stays predictable.

export type NodeBudget = {
  min: number;
  max: number;
};

const NODE_BUDGETS: Record<RoadmapTimeframe, NodeBudget> = {
  daily: { min: 4, max: 6 },
  weekly: { min: 8, max: 12 },
  monthly: { min: 16, max: 24 },
};

export function getNodeBudget(timeframe: RoadmapTimeframe): NodeBudget {
  return NODE_BUDGETS[timeframe];
}

// Average output cost per node (title + description + DAG edges share) is
// ~140-180 tokens; double it as headroom and add a fixed envelope for the
// title / JSON braces. Keeps single-shot generation under 5k output tokens
// even at the monthly cap.
export function getMaxOutputTokens(timeframe: RoadmapTimeframe): number {
  const { max } = getNodeBudget(timeframe);
  return Math.max(800, Math.round(max * 200) + 400);
}

// Subtask expansion ("Create subtasks") always asks for the same shape:
// 3-5 children + a short DAG among them. Independent of the roadmap-level
// timeframe so a daily roadmap can still expand a node into a small graph.
export const SUBTASK_NODE_BUDGET: NodeBudget = { min: 3, max: 5 };

export function getSubtaskMaxOutputTokens(): number {
  return Math.max(600, SUBTASK_NODE_BUDGET.max * 200 + 200);
}
