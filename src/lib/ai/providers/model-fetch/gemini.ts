// Google Gemini catalog adapter — GET /v1beta/models?key=KEY (no header auth).
// Response: `{models: [{name: "models/gemini-X", displayName, description,
// supportedGenerationMethods: ["generateContent", ...], inputTokenLimit, ...}]}`.
//
// Filter: `supportedGenerationMethods.includes("generateContent")` is the
// canonical "this is a chat model" signal. We additionally exclude legacy
// generations (1.x, 2.0-*) and embedding models. Tool-use isn't carried per-
// model in the catalog, but every Gemini 2.5+ and 3.x model supports function
// calling, so the generation-gate is sufficient.

import { smartFetch } from "@/lib/tauri/fetch";
import type { ModelDescriptor } from "../types";
import { inferModelTier } from "./tier-infer";
import type { ModelFetchAdapter, ModelFetchOptions, ModelFetchResult } from "./types";

interface GeminiCatalogModel {
  name?: string; // e.g. "models/gemini-2.5-pro"
  baseModelId?: string;
  version?: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}

interface GeminiCatalogEnvelope {
  models?: GeminiCatalogModel[];
  nextPageToken?: string;
}

// Modern generation gate. Drop anything older than 2.5 (deprecated by Google
// in late 2025) and the embedding/aqa families. Tutor mode (`tunedModels/`)
// also gets filtered by the `models/` prefix check.
const MODERN_GEMINI_RE = /^gemini-(2\.5|[3-9])/i;
const EMBEDDING_RE = /(embedding|aqa)/i;

export const GEMINI_MODEL_FETCH_ADAPTER: ModelFetchAdapter = {
  providerId: "google-gemini",
  requiresApiKey: true,
  endpointLabel: "gemini /v1beta/models",
  async fetch(opts: ModelFetchOptions): Promise<ModelFetchResult> {
    const base = opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    if (!opts.apiKey) return { models: [], fetchedFrom: base };
    const url = `${base.replace(/\/$/, "")}/models?key=${encodeURIComponent(opts.apiKey)}&pageSize=200`;
    try {
      const res = await smartFetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (!res.ok) return { models: [], fetchedFrom: url };
      const json = (await res.json()) as GeminiCatalogEnvelope;
      const rows = json.models ?? [];
      const models: ModelDescriptor[] = [];
      for (const row of rows) {
        const fullName = row.name;
        if (!fullName || typeof fullName !== "string") continue;
        if (!fullName.startsWith("models/")) continue;
        const id = fullName.slice("models/".length);
        if (!MODERN_GEMINI_RE.test(id)) continue;
        if (EMBEDDING_RE.test(id)) continue;
        const supportedMethods = row.supportedGenerationMethods ?? [];
        if (!supportedMethods.includes("generateContent")) continue;
        models.push({
          id,
          displayName: row.displayName ?? id,
          tier: inferModelTier(id),
        });
      }
      return { models, fetchedFrom: url };
    } catch {
      return { models: [], fetchedFrom: url };
    }
  },
};
