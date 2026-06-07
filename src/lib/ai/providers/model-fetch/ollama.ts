// Ollama catalog adapter — local /v1/models (OpenAI-compat) or /api/tags.
// No auth header; the local server doesn't require one.
//
// Local providers benefit MORE from dynamic fetching than cloud providers
// because the user picks their own arbitrary models. Static fallback lists
// only ever show the default placeholder.
//
// Tool-use capability isn't reported per-model; we trust Ollama's user to
// have picked a tool-capable model (Llama 3.1+, Qwen 2.5+, etc.). The chat
// runner surfaces an error if the chosen model fails on a tool block.

import { createOpenAICompatAdapter } from "./openai-compat";

export const OLLAMA_MODEL_FETCH_ADAPTER = createOpenAICompatAdapter({
  providerId: "ollama",
  baseUrl: "http://localhost:11434/v1",
  endpointLabel: "ollama /v1/models",
  requiresApiKey: false,
  bearerAuth: false,
});
