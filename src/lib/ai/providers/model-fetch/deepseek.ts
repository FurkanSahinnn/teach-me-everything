// DeepSeek catalog adapter — OpenAI-compat /v1/models with Bearer.
// Catalog is small (deepseek-chat, deepseek-reasoner, deepseek-coder). Both
// V3 (chat) and R1 (reasoner) support tool use; the deprecated `deepseek-v2`
// and embedding rows we drop defensively.

import { createOpenAICompatAdapter } from "./openai-compat";

const EXCLUDE_RE = /(v2|embed|moderation)/i;

export const DEEPSEEK_MODEL_FETCH_ADAPTER = createOpenAICompatAdapter({
  providerId: "deepseek",
  baseUrl: "https://api.deepseek.com/v1",
  endpointLabel: "deepseek /v1/models",
  requiresApiKey: true,
  toolFilter: (id) => !EXCLUDE_RE.test(id),
});
