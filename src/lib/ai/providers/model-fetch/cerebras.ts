// Cerebras catalog adapter — /v1/models with Bearer. Free-tier provider that
// hosts Llama 3.x/4, Qwen 3, and DeepSeek distill variants. All current
// Cerebras chat models support tool use; we drop only the embedding model
// (defensive — they may add it later).

import { createOpenAICompatAdapter } from "./openai-compat";

const EXCLUDE_RE = /(embed|moderation)/i;

export const CEREBRAS_MODEL_FETCH_ADAPTER = createOpenAICompatAdapter({
  providerId: "cerebras",
  baseUrl: "https://api.cerebras.ai/v1",
  endpointLabel: "cerebras /v1/models",
  requiresApiKey: true,
  toolFilter: (id) => !EXCLUDE_RE.test(id),
});
