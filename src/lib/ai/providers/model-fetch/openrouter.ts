// OpenRouter catalog adapter — GET /api/v1/models, no auth required.
// Response: `{data: [{id, name, description, context_length, pricing:
// {prompt, completion, image, request}, supported_parameters: ["tools",
// "tool_choice", "structured_outputs", ...], top_provider}]}`.
//
// OpenRouter is the ONE provider that ships explicit per-model tool-use info
// via `supported_parameters`. We exploit that and drop models that can't carry
// a tool block — this is how we ensure the picker never shows a "Notebook
// chat needs tool use" violation when a user picks OR.

import { smartFetch } from "@/lib/tauri/fetch";
import type { ModelDescriptor } from "../types";
import { humanizeModelId, inferModelTier } from "./tier-infer";
import type { ModelFetchAdapter, ModelFetchOptions, ModelFetchResult } from "./types";

interface OpenRouterCatalogModel {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: {
    // Strings on the wire — they're per-token USD, not per-1M.
    prompt?: string;
    completion?: string;
    image?: string;
    request?: string;
  };
  supported_parameters?: string[];
  top_provider?: { is_moderated?: boolean };
}

interface OpenRouterCatalogEnvelope {
  data?: OpenRouterCatalogModel[];
}

function parsePricePerMillion(perTokenUsd: string | undefined): number {
  if (!perTokenUsd) return 0;
  const n = Number(perTokenUsd);
  if (!Number.isFinite(n)) return 0;
  return n * 1_000_000;
}

export const OPENROUTER_MODEL_FETCH_ADAPTER: ModelFetchAdapter = {
  providerId: "openrouter",
  // OR exposes its catalog without auth — `requiresApiKey: false` lets us
  // populate the dropdown before the user has even saved a key.
  requiresApiKey: false,
  endpointLabel: "openrouter /api/v1/models",
  async fetch(opts: ModelFetchOptions): Promise<ModelFetchResult> {
    const base = opts.baseUrl ?? "https://openrouter.ai/api/v1";
    const url = `${base.replace(/\/$/, "")}/models`;
    try {
      const res = await smartFetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (!res.ok) return { models: [], fetchedFrom: url };
      const json = (await res.json()) as OpenRouterCatalogEnvelope;
      const rows = json.data ?? [];
      const models: ModelDescriptor[] = [];
      for (const row of rows) {
        const id = row.id;
        if (!id || typeof id !== "string") continue;
        const params = row.supported_parameters ?? [];
        if (!params.includes("tools")) continue;
        const inputPrice = parsePricePerMillion(row.pricing?.prompt);
        const outputPrice = parsePricePerMillion(row.pricing?.completion);
        const tier = inferModelTier(id, {
          pricing: { input: inputPrice, output: outputPrice },
        });
        models.push({
          id,
          displayName: row.name ?? humanizeModelId(id),
          tier,
        });
      }
      return { models, fetchedFrom: url };
    } catch {
      return { models: [], fetchedFrom: url };
    }
  },
};
