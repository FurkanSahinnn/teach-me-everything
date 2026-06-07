// Together AI catalog adapter — /v1/models with Bearer. Catalog is large
// (~100 models) and includes image-gen, audio, embedding, code-only models.
// We keep the chat families that historically support tool use (Llama 3.x,
// Qwen 2.5+, DeepSeek, Mixtral, Mistral) and drop everything else.

import { createOpenAICompatAdapter } from "./openai-compat";

const TOOL_CAPABLE_RE =
  /^(meta-llama\/Llama-3|Qwen\/Qwen[2-9]|deepseek-ai\/DeepSeek|mistralai\/(Mixtral|Mistral)|meta-llama\/Meta-Llama-3)/i;
const EXCLUDE_RE = /(embed|moderat|guard|stable-diffusion|flux|whisper|tts|code-?llama|stripedhyena|vision)/i;

export const TOGETHER_MODEL_FETCH_ADAPTER = createOpenAICompatAdapter({
  providerId: "together",
  baseUrl: "https://api.together.xyz/v1",
  endpointLabel: "together /v1/models",
  requiresApiKey: true,
  toolFilter: (id) => TOOL_CAPABLE_RE.test(id) && !EXCLUDE_RE.test(id),
});
