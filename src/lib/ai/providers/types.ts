import type { AnthropicTool, AnthropicToolChoice } from "../tools";

export const ANTHROPIC_API_VERSION = "2023-06-01";

export type CacheControl = { type: "ephemeral" };

export type SystemBlock = {
  type: "text";
  text: string;
  cache_control?: CacheControl;
};

export type ChatRole = "user" | "assistant";

export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type TextContentBlock = { type: "text"; text: string };

export type ContentBlock = TextContentBlock | ToolUseBlock | ToolResultBlock;

export type ChatMessage = {
  role: ChatRole;
  content: string | ContentBlock[];
};

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export type StreamEvent =
  | { kind: "start"; model: string; usage: Usage }
  | { kind: "text"; delta: string }
  | { kind: "tool_start"; index: number; id: string; name: string }
  | { kind: "tool_input_delta"; index: number; partial: string }
  | { kind: "tool_stop"; index: number }
  | { kind: "delta"; stopReason: string | null; usage: Usage }
  | { kind: "stop" }
  | { kind: "error"; status: number; message: string }
  | { kind: "abort" }
  // Phase 5.5.C.B — pass-through of the raw provider event so web-search
  // adapters can extract citations/usage without each provider importing the
  // adapter layer. Consumers that don't need it just ignore this kind.
  | { kind: "raw"; payload: unknown };

export type CloudProviderId =
  | "anthropic"
  | "openai"
  // Distinct provider for OpenAI's `/v1/responses` endpoint — needed by the
  // chat-LLM-search wrapper because the built-in `web_search` server tool
  // is only accepted on the Responses API, not Chat Completions.
  | "openai-responses"
  | "google-gemini"
  | "openrouter"
  | "groq"
  | "deepseek"
  | "glm"
  | "xai"
  | "mistral"
  | "together"
  | "cerebras"
  | "perplexity"
  | "voyage"
  | "cohere"
  | "jina"
  | "huggingface"
  | "ollama"
  | "lm-studio"
  | "llama-cpp";

export type CustomProviderId = `custom:${string}`;

export type ProviderId = CloudProviderId | CustomProviderId;

export type ProviderFamily = "anthropic" | "openai-compat" | "gemini";

export type ProviderKind = "chat" | "embed" | "both";

export type ProviderAuth =
  | { kind: "bearer" }
  | { kind: "header"; headerName: string };

export type ToolUseStrategy = "native" | "json" | "none";

export type ProviderCapabilities = {
  cacheControl: boolean;
  toolUse: ToolUseStrategy;
  streaming: boolean;
  vision: boolean;
};

// Tier is a coarse ranking surfaced as a UI badge so users pick by intent
// ("flagship for hard questions", "fast for tag generation") without having
// to memorize raw model IDs. "free" overrides the others when the model is
// genuinely zero-cost (free tier or local) so the chip stays informative.
export type ModelTier = "flagship" | "balanced" | "fast" | "free";

export type ModelDescriptor = {
  id: string;
  displayName: string;
  tier: ModelTier;
  hint?: string;
};

// id is widened to ProviderId so the registry can synthesize presets for
// `custom:${string}` endpoints at runtime. The hardcoded PROVIDER_PRESETS
// map still keys on CloudProviderId; only the synthesized variant uses the
// custom prefix.
export type ProviderPreset = {
  id: ProviderId;
  label: string;
  family: ProviderFamily;
  kind: ProviderKind;
  baseUrl: string;
  auth: ProviderAuth;
  capabilities: ProviderCapabilities;
  defaultModels: { chat?: string; embed?: string };
  // Curated catalog used to populate the Model dropdown in Settings → Models.
  // Optional so synthesized custom-endpoint presets and embed-only providers
  // don't have to declare it; ChatModelRow falls back to defaultModels.chat.
  availableModels?: ModelDescriptor[];
  freeTier?: boolean;
  docsUrl: string;
};

export type ChatRequest = {
  apiKey: string;
  model: string;
  system: SystemBlock[];
  messages: ChatMessage[];
  maxTokens?: number;
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  signal?: AbortSignal;
  /**
   * For Anthropic only: which credential kind the apiKey is. "api-key" maps to
   * `x-api-key` header; "oauth" maps to `Authorization: Bearer …` plus the
   * `anthropic-beta: oauth-2025-04-20` header. Defaults to "api-key" so non-
   * Anthropic providers and existing call sites stay backwards-compatible.
   */
  authKind?: "oauth" | "api-key";
};

export type ChatStreamHandle = {
  events: AsyncIterable<StreamEvent>;
  abort: () => void;
};

export interface ChatProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  streamChat(req: ChatRequest): ChatStreamHandle;
}

export type EmbedRequest = {
  apiKey: string;
  model: string;
  inputs: string[];
  signal?: AbortSignal;
};

export type EmbedResult = {
  vectors: Float32Array[];
  model: string;
  dim: number;
};

export interface EmbedProvider {
  readonly id: ProviderId;
  embed(req: EmbedRequest): Promise<EmbedResult>;
  dimFor(model: string): number;
}

export class ProviderError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.code = code;
  }
}
