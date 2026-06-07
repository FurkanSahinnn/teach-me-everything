// Phase 10.C — `useProviderChatModels` hook.
//
// Reactive read of the cached `/models` catalog for one provider preset. The
// picker calls this once per provider row in Settings; the hook handles:
//   1. Dexie `useLiveQuery` lookup against `providerModelsCache`
//   2. Auto-fetch on cache miss or staleness (7-day TTL)
//   3. Static fallback when the adapter doesn't exist (custom: presets,
//      perplexity) or the catalog returns empty (e.g. revoked key)
//   4. Manual `refresh()` action for the "↻ Yenile" button
//   5. Provider-id → api-key-provider mapping (openai-responses → openai)
//
// State machine:
//   - cached === undefined  ⇒ Dexie still loading      → static + loading
//   - cached === null       ⇒ row missing              → fetch + static fallback
//   - cached !== null fresh ⇒ row present, !stale      → dynamic
//   - cached !== null stale ⇒ row present, stale       → dynamic + background refresh
//
// The hook never throws. Adapter failures surface as `error: string | null`
// but the picker keeps rendering the static fallback so the UI never goes
// blank on a bad key.

"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getApiKey } from "@/lib/db/api-keys-repo";
import {
  isCacheStale,
  PROVIDER_MODELS_CACHE_TTL_MS,
  putCachedModels,
} from "@/lib/db/provider-models-repo";
import { db } from "@/lib/db/schema";
import type { ApiKeyProvider } from "@/lib/db/schema";
import { getModelFetchAdapter } from "@/lib/ai/providers/model-fetch/adapter";
import { getProviderChatModels } from "@/lib/ai/model-options";
import { getPreset } from "@/lib/ai/providers/presets";
import type {
  ModelDescriptor,
  ProviderId,
} from "@/lib/ai/providers/types";

export type ChatModelsSource = "static" | "dynamic" | "loading";

export interface UseProviderChatModelsResult {
  /** Display list — dynamic when cached + non-empty, else static fallback. */
  models: ModelDescriptor[];
  /** Where `models` originated. UI surfaces a subtle "fetched X min ago" hint. */
  source: ChatModelsSource;
  /** True while a fetch is in flight (initial OR `refresh()` call). */
  isFetching: boolean;
  /** Last fetch failure reason; null when no error. */
  error: string | null;
  /** epoch-ms of the cached row, or null when no dynamic data exists. */
  fetchedAt: number | null;
  /** Force a refetch — used by the "↻ Yenile" button. Idempotent. */
  refresh: () => Promise<void>;
}

/**
 * Map a chat-preset id to the api-keys-repo provider id. Only one alias
 * exists today (openai-responses uses the openai key) but the helper exists
 * so future shared-key providers can be added without churning callers.
 */
function resolveApiKeyProvider(presetId: ProviderId): ApiKeyProvider {
  if (presetId === "openai-responses") return "openai";
  return presetId as ApiKeyProvider;
}

export function useProviderChatModels(
  presetId: ProviderId,
): UseProviderChatModelsResult {
  const cached = useLiveQuery(
    async () => {
      const row = await db.providerModelsCache.get(presetId);
      return row ?? null;
    },
    [presetId],
    undefined,
  );

  const adapter = useMemo(() => getModelFetchAdapter(presetId), [presetId]);
  const staticModels = useMemo(
    () => getProviderChatModels(presetId),
    [presetId],
  );
  const baseUrl = useMemo(() => getPreset(presetId)?.baseUrl, [presetId]);

  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guard against duplicate concurrent fetches (cache-miss effect + manual
  // refresh racing). Ref instead of state because we never need to re-render
  // on toggle — it only protects the doFetch entry.
  const fetchInflightRef = useRef(false);

  const doFetch = useCallback(async (): Promise<void> => {
    if (!adapter) return;
    if (fetchInflightRef.current) return;
    fetchInflightRef.current = true;
    setIsFetching(true);
    setError(null);
    try {
      let apiKey: string | undefined;
      if (adapter.requiresApiKey) {
        const stored = await getApiKey(resolveApiKeyProvider(presetId));
        if (!stored) {
          setError("missing_api_key");
          return;
        }
        apiKey = stored;
      } else {
        // Optional auth (OpenRouter catalog is public; local providers don't
        // need auth). Still pass the key if available so providers that
        // *accept* an auth header but don't require one get rate-limit relief.
        const stored = await getApiKey(resolveApiKeyProvider(presetId));
        apiKey = stored ?? undefined;
      }

      const fetchOpts: Parameters<typeof adapter.fetch>[0] = {};
      if (apiKey !== undefined) fetchOpts.apiKey = apiKey;
      if (baseUrl !== undefined) fetchOpts.baseUrl = baseUrl;
      const result = await adapter.fetch(fetchOpts);

      if (result.models.length === 0) {
        setError("empty_catalog");
        return;
      }
      await putCachedModels({
        presetId,
        baseUrl: baseUrl ?? "",
        models: result.models,
        fetchedAt: Date.now(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      fetchInflightRef.current = false;
      setIsFetching(false);
    }
  }, [adapter, presetId, baseUrl]);

  // Auto-fetch on cache miss + background-refresh on staleness. We DON'T
  // fetch when adapter is null (no provider support), or when an `undefined`
  // cached value indicates Dexie's first paint (let useLiveQuery resolve
  // first to avoid a redundant fetch on every mount).
  useEffect(() => {
    if (!adapter) return;
    if (cached === undefined) return;
    if (cached === null) {
      void doFetch();
      return;
    }
    const stale = isCacheStale(cached, {
      ttlMs: PROVIDER_MODELS_CACHE_TTL_MS,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    });
    if (stale) {
      void doFetch();
    }
  }, [adapter, cached, baseUrl, doFetch]);

  // Result projection — dynamic when cached row is present + non-empty.
  if (cached === undefined) {
    return {
      models: staticModels,
      source: "loading",
      isFetching,
      error,
      fetchedAt: null,
      refresh: doFetch,
    };
  }
  if (cached !== null && cached.models.length > 0) {
    return {
      models: cached.models,
      source: "dynamic",
      isFetching,
      error,
      fetchedAt: cached.fetchedAt,
      refresh: doFetch,
    };
  }
  return {
    models: staticModels,
    source: "static",
    isFetching,
    error,
    fetchedAt: null,
    refresh: doFetch,
  };
}
