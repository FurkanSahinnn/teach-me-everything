// OpenAI catalog adapter — GET /v1/models with Bearer auth.
// Response shape is OpenAI's standard envelope. We filter aggressively because
// the same endpoint surfaces embeddings, dall-e, tts, whisper, moderation,
// realtime, and other non-chat model classes. Only chat-capable families
// (gpt-3.5+, gpt-4+, gpt-5+, o-series, chatgpt-) survive.

import { createOpenAICompatAdapter } from "./openai-compat";

const CHAT_MODEL_RE =
  /^(gpt-(3\.5|4|5)|o[1-9](-|$)|chatgpt-)/i;

const EXCLUDE_RE =
  /(embedding|tts|whisper|dall-?e|moderation|audio|realtime|babbage|davinci|ada|curie|search|computer-use)/i;

export const OPENAI_MODEL_FETCH_ADAPTER = createOpenAICompatAdapter({
  providerId: "openai",
  baseUrl: "https://api.openai.com/v1",
  endpointLabel: "openai /v1/models",
  requiresApiKey: true,
  toolFilter: (id) => CHAT_MODEL_RE.test(id) && !EXCLUDE_RE.test(id),
});

// `openai-responses` shares the same catalog — `/v1/responses` accepts the
// same model ids as `/v1/chat/completions`.
export const OPENAI_RESPONSES_MODEL_FETCH_ADAPTER = createOpenAICompatAdapter({
  providerId: "openai-responses",
  baseUrl: "https://api.openai.com/v1",
  endpointLabel: "openai /v1/models (responses)",
  requiresApiKey: true,
  toolFilter: (id) => CHAT_MODEL_RE.test(id) && !EXCLUDE_RE.test(id),
});
