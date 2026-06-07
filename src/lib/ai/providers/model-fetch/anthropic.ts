// Anthropic catalog adapter — GET /v1/models with x-api-key + anthropic-version.
// Response: `{data: [{id, type: "model", display_name, created_at}], has_more}`.
// All Claude models in the current catalog support tool use natively, so we
// don't filter; only `claude-*` slugs make it through as a defensive measure
// against future non-chat additions.

import { smartFetch } from "@/lib/tauri/fetch";
import { ANTHROPIC_API_VERSION } from "../types";
import type { ModelDescriptor } from "../types";
import { inferModelTier } from "./tier-infer";
import type { ModelFetchAdapter, ModelFetchOptions, ModelFetchResult } from "./types";

interface AnthropicCatalogModel {
  id?: string;
  type?: string;
  display_name?: string;
  created_at?: string;
}

interface AnthropicCatalogEnvelope {
  data?: AnthropicCatalogModel[];
  has_more?: boolean;
}

export const ANTHROPIC_MODEL_FETCH_ADAPTER: ModelFetchAdapter = {
  providerId: "anthropic",
  requiresApiKey: true,
  endpointLabel: "anthropic /v1/models",
  async fetch(opts: ModelFetchOptions): Promise<ModelFetchResult> {
    const base = opts.baseUrl ?? "https://api.anthropic.com";
    const url = `${base.replace(/\/$/, "")}/v1/models?limit=100`;
    if (!opts.apiKey) return { models: [], fetchedFrom: url };
    try {
      const res = await smartFetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "x-api-key": opts.apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (!res.ok) return { models: [], fetchedFrom: url };
      const json = (await res.json()) as AnthropicCatalogEnvelope;
      const rows = json.data ?? [];
      const models: ModelDescriptor[] = [];
      for (const row of rows) {
        const id = row.id;
        if (!id || typeof id !== "string") continue;
        if (!id.startsWith("claude-")) continue;
        models.push({
          id,
          displayName: row.display_name ?? id,
          tier: inferModelTier(id),
        });
      }
      return { models, fetchedFrom: url };
    } catch {
      return { models: [], fetchedFrom: url };
    }
  },
};
