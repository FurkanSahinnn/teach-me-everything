// GLM (Zhipu AI) catalog adapter — OpenAI-compat /api/paas/v4/models with
// Bearer. Surfaces glm-4-flash through glm-4.6; we filter out embedding and
// image-gen models. Zhipu's free-tier `glm-4-flash` shows up here too.

import { createOpenAICompatAdapter } from "./openai-compat";

const CHAT_RE = /^glm-/i;
const EXCLUDE_RE = /(embed|cogvi|cogvlm|cogview|charglm)/i;

export const GLM_MODEL_FETCH_ADAPTER = createOpenAICompatAdapter({
  providerId: "glm",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  endpointLabel: "glm /v4/models",
  requiresApiKey: true,
  toolFilter: (id) => CHAT_RE.test(id) && !EXCLUDE_RE.test(id),
});
