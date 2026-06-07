// Mistral catalog adapter — GET /v1/models with Bearer auth.
// Response: `{data: [{id, name, description, max_context_length, capabilities:
// {completion_chat, completion_fim, function_calling, fine_tuning, vision},
// type: "base"|"fine-tuned", aliases, ...}]}`.
//
// Mistral is one of the few providers that publishes per-model tool-use
// capability in the catalog, so we filter on `capabilities.function_calling`
// + `capabilities.completion_chat` rather than a model-id regex.

import { smartFetch } from "@/lib/tauri/fetch";
import type { ModelDescriptor } from "../types";
import { inferModelTier } from "./tier-infer";
import type { ModelFetchAdapter, ModelFetchOptions, ModelFetchResult } from "./types";

interface MistralCatalogModel {
  id?: string;
  name?: string;
  description?: string;
  type?: string;
  capabilities?: {
    completion_chat?: boolean;
    function_calling?: boolean;
    vision?: boolean;
    fine_tuning?: boolean;
  };
}

interface MistralCatalogEnvelope {
  data?: MistralCatalogModel[];
}

export const MISTRAL_MODEL_FETCH_ADAPTER: ModelFetchAdapter = {
  providerId: "mistral",
  requiresApiKey: true,
  endpointLabel: "mistral /v1/models",
  async fetch(opts: ModelFetchOptions): Promise<ModelFetchResult> {
    const base = opts.baseUrl ?? "https://api.mistral.ai/v1";
    const url = `${base.replace(/\/$/, "")}/models`;
    if (!opts.apiKey) return { models: [], fetchedFrom: url };
    try {
      const res = await smartFetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (!res.ok) return { models: [], fetchedFrom: url };
      const json = (await res.json()) as MistralCatalogEnvelope;
      const rows = json.data ?? [];
      const models: ModelDescriptor[] = [];
      for (const row of rows) {
        const id = row.id;
        if (!id || typeof id !== "string") continue;
        const caps = row.capabilities ?? {};
        if (caps.completion_chat !== true) continue;
        if (caps.function_calling !== true) continue;
        models.push({
          id,
          displayName: row.name ?? id,
          tier: inferModelTier(id),
        });
      }
      return { models, fetchedFrom: url };
    } catch {
      return { models: [], fetchedFrom: url };
    }
  },
};
