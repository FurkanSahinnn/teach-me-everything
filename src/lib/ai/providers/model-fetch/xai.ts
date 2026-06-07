// xAI Grok catalog adapter — OpenAI-compat /v1/models with Bearer.
// Grok 2 family lacks function calling, so we drop it; Grok 3 and Grok 4
// support tool use natively.

import { createOpenAICompatAdapter } from "./openai-compat";

const CHAT_RE = /^grok-/i;
// Grok-2-* models predate function calling and aren't usable in notebook
// chat — keep them out so the picker stays honest.
const EXCLUDE_RE = /^grok-2/i;

export const XAI_MODEL_FETCH_ADAPTER = createOpenAICompatAdapter({
  providerId: "xai",
  baseUrl: "https://api.x.ai/v1",
  endpointLabel: "xai /v1/models",
  requiresApiKey: true,
  toolFilter: (id) => CHAT_RE.test(id) && !EXCLUDE_RE.test(id),
});
