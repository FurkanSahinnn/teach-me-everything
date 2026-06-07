// llama.cpp catalog adapter — local /v1/models, no auth. Same shape as
// LM Studio. The server typically returns one or two rows (whatever GGUFs
// the user loaded with the binary).

import { createOpenAICompatAdapter } from "./openai-compat";

export const LLAMA_CPP_MODEL_FETCH_ADAPTER = createOpenAICompatAdapter({
  providerId: "llama-cpp",
  baseUrl: "http://localhost:8080/v1",
  endpointLabel: "llama.cpp /v1/models",
  requiresApiKey: false,
  bearerAuth: false,
});
