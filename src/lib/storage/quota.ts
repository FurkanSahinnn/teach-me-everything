"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/db/schema";
import { setEmbeddingStatus } from "@/lib/db/sources";

export type QuotaWarningLevel = "none" | "warn" | "critical";

export interface StorageQuotaState {
  used: number;
  total: number;
  level: QuotaWarningLevel;
}

const WARN_THRESHOLD = 0.75;
const CRITICAL_THRESHOLD = 0.9;
const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function getQuotaWarningLevel(
  usedBytes: number,
  totalBytes: number,
): QuotaWarningLevel {
  if (totalBytes <= 0) return "none";
  const ratio = usedBytes / totalBytes;
  if (ratio >= CRITICAL_THRESHOLD) return "critical";
  if (ratio >= WARN_THRESHOLD) return "warn";
  return "none";
}

async function readEstimate(): Promise<StorageQuotaState> {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.estimate !== "function"
  ) {
    return { used: 0, total: 0, level: "none" };
  }
  try {
    const est = await navigator.storage.estimate();
    const used = est.usage ?? 0;
    const total = est.quota ?? 0;
    return { used, total, level: getQuotaWarningLevel(used, total) };
  } catch {
    return { used: 0, total: 0, level: "none" };
  }
}

export function useStorageQuota(): StorageQuotaState {
  // Synchronous initial state — never returns null to consumers — and gets
  // replaced by the first async sample on mount.
  const [state, setState] = useState<StorageQuotaState>({
    used: 0,
    total: 0,
    level: "none",
  });

  useEffect(() => {
    let cancelled = false;
    const sample = async (): Promise<void> => {
      const next = await readEstimate();
      if (!cancelled) setState(next);
    };
    void sample();
    const id = window.setInterval(() => {
      void sample();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return state;
}

// Strip embedding vectors to free IndexedDB space. The chunk text + metadata
// stay intact, so retrieval still works in BM25/lexical fallback mode and the
// user can re-embed later. Cascades affected sources to embeddingStatus=missing
// so the UI reflects that they no longer have vectors attached.
export async function pruneEmbeddings(
  workspaceId?: string,
): Promise<{ cleared: number }> {
  let cleared = 0;
  const affectedSourceIds = new Set<string>();

  const collection =
    workspaceId === undefined
      ? db.chunks.toCollection()
      : db.chunks.where("workspaceId").equals(workspaceId);

  await collection.modify((chunk) => {
    if (chunk.embedding !== undefined || chunk.embeddingModel !== undefined) {
      // Use `delete` so the property is dropped, not stored as undefined.
      delete chunk.embedding;
      delete chunk.embeddingModel;
      affectedSourceIds.add(chunk.sourceId);
      cleared += 1;
    }
  });

  // Best-effort: flag sources back to "ready" (they still have parsed text
  // chunks). We swallow individual errors so a single bad row cannot block
  // the user from reclaiming space.
  for (const sourceId of affectedSourceIds) {
    try {
      await setEmbeddingStatus(sourceId, "missing");
    } catch {
      /* noop */
    }
  }

  return { cleared };
}
