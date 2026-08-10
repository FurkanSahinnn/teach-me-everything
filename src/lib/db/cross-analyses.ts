import type { UpdateSpec } from "dexie";

import { newId } from "@/lib/utils/id";
import { db } from "./schema";
import type {
  AnalysisTargetLang,
  AnalysisUsage,
  ComparedPaper,
  CrossAnalysisModelSnapshot,
  CrossAnalysisPayload,
  CrossAnalysisRecord,
  CrossAnalysisStatus,
} from "@/lib/cross-analysis/types";

// ---------------------------------------------------------------------------
// Cross-Analysis (one row per comparison of 2-4 already-analyzed papers)
// ---------------------------------------------------------------------------

export type CreateCrossAnalysisInput = {
  workspaceId: string;
  title: string;
  targetLang: AnalysisTargetLang;
  // Order is authoritative — it defines paperIndex in the payload.
  analysisIds: string[];
  papers: ComparedPaper[];
  modelSnapshot: CrossAnalysisModelSnapshot;
  usage?: AnalysisUsage;
  status?: CrossAnalysisStatus;
};

const ZERO_USAGE: AnalysisUsage = { inputTokens: 0, outputTokens: 0 };

export async function createCrossAnalysis(
  input: CreateCrossAnalysisInput,
): Promise<CrossAnalysisRecord> {
  const now = Date.now();
  const record: CrossAnalysisRecord = {
    id: newId("xan"),
    workspaceId: input.workspaceId,
    title: input.title,
    targetLang: input.targetLang,
    status: input.status ?? "generating",
    analysisIds: input.analysisIds,
    papers: input.papers,
    modelSnapshot: input.modelSnapshot,
    usage: input.usage ?? ZERO_USAGE,
    createdAt: now,
    updatedAt: now,
  };
  await db.crossAnalyses.add(record);
  return record;
}

export async function getCrossAnalysis(
  id: string,
): Promise<CrossAnalysisRecord | undefined> {
  return db.crossAnalyses.get(id);
}

export async function listCrossAnalysesByWorkspace(
  workspaceId: string,
): Promise<CrossAnalysisRecord[]> {
  const rows = await db.crossAnalyses
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

// Comparisons that reference a given analysis — via the multiEntry
// `*analysisIds` index, so this stays a lookup rather than a table scan.
export async function listCrossAnalysesByAnalysis(
  analysisId: string,
): Promise<CrossAnalysisRecord[]> {
  const rows = await db.crossAnalyses
    .where("analysisIds")
    .equals(analysisId)
    .toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export type CrossAnalysisPatch = Partial<{
  title: string;
  status: CrossAnalysisStatus;
  modelSnapshot: CrossAnalysisModelSnapshot;
  usage: AnalysisUsage;
  papers: ComparedPaper[];
  // `null` is the explicit-clear signal (translated to undefined so Dexie
  // drops the field rather than storing a JSON null) — mirrors updateAnalysis.
  payload: CrossAnalysisPayload | null;
  fallbackReason: string | null;
  errorMessage: string | null;
}>;

export async function updateCrossAnalysis(
  id: string,
  patch: CrossAnalysisPatch,
): Promise<void> {
  const next: Record<string, unknown> = { updatedAt: Date.now() };
  for (const [key, value] of Object.entries(patch)) {
    next[key] = value === null ? undefined : value;
  }
  // Dexie's UpdateSpec expands array fields into `analysisIds.${number}` keyed
  // paths, which no generic string-keyed bag can satisfy. The patch shape is
  // already constrained by CrossAnalysisPatch above, so narrow it back here.
  await db.crossAnalyses.update(id, next as UpdateSpec<CrossAnalysisRecord>);
}

export type CrossAnalysisStatusExtra = {
  payload?: CrossAnalysisPayload | null;
  usage?: AnalysisUsage;
  papers?: ComparedPaper[];
  fallbackReason?: string | null;
  errorMessage?: string | null;
};

export async function setCrossAnalysisStatus(
  id: string,
  status: CrossAnalysisStatus,
  extra?: CrossAnalysisStatusExtra,
): Promise<void> {
  await updateCrossAnalysis(id, {
    status,
    ...(extra?.payload !== undefined ? { payload: extra.payload } : {}),
    ...(extra?.usage !== undefined ? { usage: extra.usage } : {}),
    ...(extra?.papers !== undefined ? { papers: extra.papers } : {}),
    ...(extra?.fallbackReason !== undefined
      ? { fallbackReason: extra.fallbackReason }
      : {}),
    ...(extra?.errorMessage !== undefined
      ? { errorMessage: extra.errorMessage }
      : {}),
  });
}

export async function deleteCrossAnalysis(id: string): Promise<void> {
  await db.crossAnalyses.delete(id);
}

// Comparisons are snapshots: `papers` carries the titles and the payload holds
// the resolved claim text, so a comparison stays readable after one of its
// analyses is deleted. Nothing cascades — this exists so callers deleting an
// analysis can OFFER to clean up, not so deletion silently destroys history.
export async function deleteCrossAnalysesForAnalysis(
  analysisId: string,
): Promise<number> {
  const rows = await listCrossAnalysesByAnalysis(analysisId);
  await db.crossAnalyses.bulkDelete(rows.map((r) => r.id));
  return rows.length;
}
