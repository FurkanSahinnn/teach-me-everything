// Phase 10.B — Provider models cache repo.
//
// CRUD wrapper around the `providerModelsCache` table (Dexie v25). One row
// per provider preset, keyed by `presetId`. The hook layer
// (`useProviderChatModels`) reads this table via `useLiveQuery` to render
// the picker dropdown and writes it after a successful catalog fetch.
//
// Staleness is decided in code (not at the DB layer) so callers can pass an
// override TTL during tests. Default TTL is 7 days — chosen because Anthropic
// / OpenAI / Gemini publish catalog changes on a roughly weekly cadence and a
// shorter TTL hammers free-tier rate limits on every Settings open.

import { db } from "./schema";
import type { ProviderModelsCacheRecord } from "./schema";
import type { ProviderId } from "@/lib/ai/providers/types";

/** Catalog TTL — 7 days expressed in ms. Exposed for hook + tests. */
export const PROVIDER_MODELS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Returns the cached row for a preset, or `undefined` on cache miss. */
export async function getCachedModels(
  presetId: ProviderId,
): Promise<ProviderModelsCacheRecord | undefined> {
  return db.providerModelsCache.get(presetId);
}

/** Persist a fresh catalog row. Overwrites any prior entry for the preset. */
export async function putCachedModels(
  record: ProviderModelsCacheRecord,
): Promise<void> {
  await db.providerModelsCache.put(record);
}

/** Drop the row for one preset. No-op when no row exists. */
export async function clearCachedModels(presetId: ProviderId): Promise<void> {
  await db.providerModelsCache.delete(presetId);
}

/** Drop every cached row. Used by Settings "Reset all model caches" action. */
export async function clearAllCachedModels(): Promise<void> {
  await db.providerModelsCache.clear();
}

/**
 * True when the row is older than `ttlMs` OR when its captured `baseUrl`
 * disagrees with the caller's current baseUrl (user pointed the preset at a
 * different endpoint — invalidate). Callers that don't know the baseUrl can
 * omit it; the function then only checks age.
 */
export function isCacheStale(
  record: ProviderModelsCacheRecord | undefined,
  opts: {
    now?: number;
    ttlMs?: number;
    baseUrl?: string | undefined;
  } = {},
): boolean {
  if (!record) return true;
  const now = opts.now ?? Date.now();
  const ttl = opts.ttlMs ?? PROVIDER_MODELS_CACHE_TTL_MS;
  if (now - record.fetchedAt > ttl) return true;
  if (opts.baseUrl !== undefined && opts.baseUrl !== record.baseUrl) {
    return true;
  }
  return false;
}
