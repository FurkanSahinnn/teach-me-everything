// Groq catalog adapter — OpenAI-compat /openai/v1/models with Bearer.
// Drop whisper/tts/distil families (Groq hosts them alongside chat models).

import { createOpenAICompatAdapter } from "./openai-compat";

const EXCLUDE_RE = /(whisper|tts|distil|guard)/i;

export const GROQ_MODEL_FETCH_ADAPTER = createOpenAICompatAdapter({
  providerId: "groq",
  baseUrl: "https://api.groq.com/openai/v1",
  endpointLabel: "groq /openai/v1/models",
  requiresApiKey: true,
  toolFilter: (id) => !EXCLUDE_RE.test(id),
});
