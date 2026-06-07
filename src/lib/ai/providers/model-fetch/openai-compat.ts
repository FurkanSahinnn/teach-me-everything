// Phase 10.A — Shared adapter factory for OpenAI-compatible `/v1/models`
// catalogs. Groq, DeepSeek, GLM (Zhipu), xAI, Together, Cerebras, and the
// local providers (Ollama, LM Studio, llama.cpp) all return the same envelope
// shape: `{object: "list", data: [{id, object: "model", created, owned_by}]}`.
// We factor the boilerplate out and let per-provider files pass only their
// id / baseUrl / filter / display-name overrides.
//
// Tool-use capability isn't carried in the OpenAI catalog response. Per-
// provider files supply an optional `toolFilter` regex (e.g. xAI excludes
// `grok-2-*` because Grok 2 series lacks function calling). When no filter
// is supplied we return the catalog as-is and trust the provider's preset
// to claim tool-use at the family level.

import { smartFetch } from "@/lib/tauri/fetch";
import type { ModelDescriptor, ProviderId } from "../types";
import { humanizeModelId, inferModelTier } from "./tier-infer";
import type {
  ModelFetchAdapter,
  ModelFetchOptions,
  ModelFetchResult,
} from "./types";

interface OpenAICatalogModel {
  id?: string;
  object?: string;
  owned_by?: string;
  // Some providers (Mistral, OpenRouter) add capability info — captured here
  // for downstream adapters that re-use the parse helper. The bare factory
  // ignores everything beyond `id`.
  display_name?: string;
  name?: string;
  description?: string;
}

interface OpenAICatalogEnvelope {
  data?: OpenAICatalogModel[];
  models?: OpenAICatalogModel[]; // some providers diverge to `models`
}

export interface OpenAICompatAdapterConfig {
  providerId: ProviderId;
  baseUrl: string;
  endpointLabel: string;
  requiresApiKey: boolean;
  /** When true, send `Authorization: Bearer ${apiKey}`; false skips header. */
  bearerAuth?: boolean;
  /** Path segment appended to baseUrl. Defaults to `/models`. */
  modelsPath?: string;
  /** Drop models whose id doesn't match this regex. Excludes embeddings, audio, etc. */
  toolFilter?: (id: string) => boolean;
  /** Override the default `humanizeModelId` rendering. */
  displayName?: (raw: OpenAICatalogModel) => string;
}

export function createOpenAICompatAdapter(
  config: OpenAICompatAdapterConfig,
): ModelFetchAdapter {
  const bearer = config.bearerAuth !== false;
  return {
    providerId: config.providerId,
    requiresApiKey: config.requiresApiKey,
    endpointLabel: config.endpointLabel,
    async fetch(opts: ModelFetchOptions): Promise<ModelFetchResult> {
      const base = opts.baseUrl ?? config.baseUrl;
      const url = `${base.replace(/\/$/, "")}${config.modelsPath ?? "/models"}`;
      const headers: Record<string, string> = { Accept: "application/json" };
      if (bearer && config.requiresApiKey && opts.apiKey) {
        headers.Authorization = `Bearer ${opts.apiKey}`;
      }
      try {
        const res = await smartFetch(url, {
          method: "GET",
          headers,
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
        if (!res.ok) return { models: [], fetchedFrom: url };
        const json = (await res.json()) as OpenAICatalogEnvelope;
        const rows = json.data ?? json.models ?? [];
        const models: ModelDescriptor[] = [];
        for (const row of rows) {
          const id = row.id;
          if (!id || typeof id !== "string") continue;
          if (config.toolFilter && !config.toolFilter(id)) continue;
          const displayName =
            (config.displayName ? config.displayName(row) : undefined) ??
            row.display_name ??
            row.name ??
            humanizeModelId(id);
          models.push({
            id,
            displayName,
            tier: inferModelTier(id),
          });
        }
        return { models, fetchedFrom: url };
      } catch {
        return { models: [], fetchedFrom: url };
      }
    },
  };
}
