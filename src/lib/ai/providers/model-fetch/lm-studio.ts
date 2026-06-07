// LM Studio catalog adapter — local /v1/models, no auth. LM Studio loads
// whichever GGUF model the user picked in the desktop app, so the catalog
// returns exactly one row most of the time. Showing the picker dynamically
// is still useful because the user can rotate models without restarting TME.

import { createOpenAICompatAdapter } from "./openai-compat";

export const LM_STUDIO_MODEL_FETCH_ADAPTER = createOpenAICompatAdapter({
  providerId: "lm-studio",
  baseUrl: "http://localhost:1234/v1",
  endpointLabel: "lm-studio /v1/models",
  requiresApiKey: false,
  bearerAuth: false,
});
