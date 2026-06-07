import { findCustomEndpoint } from "@/stores/prefs";
import { AnthropicChatProvider } from "./anthropic";
import { getAnthropicOAuthChatProvider } from "./anthropic-oauth";
import { CohereEmbedProvider } from "./embed-cohere";
import { GeminiEmbedProvider } from "./embed-gemini";
import { HuggingFaceEmbedProvider } from "./embed-hf";
import { JinaEmbedProvider } from "./embed-jina";
import { OpenAICompatEmbedProvider } from "./embed-openai-compat";
import { OpenAIEmbedProvider } from "./embed-openai";
import { VoyageEmbedProvider } from "./embed-voyage";
import { GeminiChatProvider } from "./gemini";
import { isLocalUrl } from "./local-bypass";
import { OpenAICompatChatProvider } from "./openai-compat";
import { OpenAIResponsesChatProvider } from "./openai-responses";
import { getPreset } from "./presets";
import {
  ProviderError,
  type ChatProvider,
  type EmbedProvider,
  type ProviderId,
  type ProviderPreset,
} from "./types";

const chatCache = new Map<ProviderId, ChatProvider>([
  ["anthropic", new AnthropicChatProvider()],
]);

const embedCache = new Map<ProviderId, EmbedProvider>([
  ["openai", new OpenAIEmbedProvider()],
]);

function synthesizeCustomPreset(id: ProviderId): ProviderPreset | undefined {
  if (!id.startsWith("custom:")) return undefined;
  const epId = id.slice("custom:".length);
  const ep = findCustomEndpoint(epId);
  if (!ep) return undefined;
  return {
    id,
    label: ep.label,
    family: ep.family,
    kind: "chat",
    baseUrl: ep.baseUrl,
    // Bearer is the lowest-common-denominator that openai-compat and most
    // self-hosted gateways accept; an empty key is omitted by the adapter.
    auth: { kind: "bearer" },
    capabilities: {
      cacheControl: false,
      // toolUse defaults to "json" because we cannot probe the model's true
      // capability — JSON-via-prompt is the safe fallback. The flashcard tool
      // path will degrade gracefully (3.2.E) instead of erroring out.
      toolUse: "json",
      streaming: true,
      vision: false,
    },
    defaultModels: { chat: "local-model" },
    freeTier: isLocalUrl(ep.baseUrl),
    docsUrl: "",
  };
}

function constructChatProvider(id: ProviderId): ChatProvider {
  if (id === "anthropic") return new AnthropicChatProvider();
  // Responses API uses a dedicated provider class — Chat Completions can't
  // accept the `web_search` built-in tool that drives chat-LLM search.
  if (id === "openai-responses") return new OpenAIResponsesChatProvider();

  const preset = getPreset(id) ?? synthesizeCustomPreset(id);
  if (!preset) {
    throw new ProviderError(404, "unknown_provider", `Unknown chat provider: ${id}`);
  }
  if (preset.kind === "embed") {
    throw new ProviderError(400, "embed_only", `Provider ${id} is embed-only`);
  }
  if (preset.family === "openai-compat") {
    return new OpenAICompatChatProvider({ preset });
  }
  if (preset.family === "gemini") {
    return new GeminiChatProvider({ preset });
  }
  throw new ProviderError(501, "not_implemented", `No chat adapter for family ${preset.family}`);
}

function constructEmbedProvider(id: ProviderId): EmbedProvider {
  if (id === "openai") return new OpenAIEmbedProvider();
  if (id === "voyage") return new VoyageEmbedProvider();
  if (id === "google-gemini") return new GeminiEmbedProvider();
  if (id === "cohere") return new CohereEmbedProvider();
  if (id === "jina") return new JinaEmbedProvider();
  if (id === "huggingface") return new HuggingFaceEmbedProvider();
  if (id === "mistral") {
    return new OpenAICompatEmbedProvider({ providerId: "mistral" });
  }
  if (id === "openrouter") {
    // OpenRouter's embeddings endpoint is OpenAI-compatible; routed via the
    // proxy (web) / direct upstream (Tauri) by the openai-compat adapter.
    return new OpenAICompatEmbedProvider({ providerId: "openrouter" });
  }
  if (id === "ollama") {
    return new OpenAICompatEmbedProvider({
      providerId: "ollama",
      baseUrl: "http://localhost:11434/v1",
      isLocal: true,
    });
  }

  // Custom endpoints (custom:xxx) — synthesize from prefs and route through
  // the openai-compat adapter; isLocal bypasses the proxy at adapter layer.
  const customPreset = synthesizeCustomPreset(id);
  if (customPreset) {
    return new OpenAICompatEmbedProvider({
      providerId: id,
      baseUrl: customPreset.baseUrl,
      isLocal: isLocalUrl(customPreset.baseUrl),
    });
  }

  const preset = getPreset(id);
  if (!preset) {
    throw new ProviderError(404, "unknown_provider", `Unknown embed provider: ${id}`);
  }
  if (preset.kind === "chat") {
    throw new ProviderError(400, "chat_only", `Provider ${id} is chat-only`);
  }
  throw new ProviderError(501, "not_implemented", `No embed adapter for ${id}`);
}

export type GetChatProviderOpts = {
  /**
   * For Anthropic only: when "oauth", return the AnthropicOAuthChatProvider
   * which fronts /api/ai/chat-oauth (claude-agent-sdk + Claude Code subprocess
   * with the user's CLAUDE_CODE_OAUTH_TOKEN). Default behaviour ("api-key" or
   * unset) returns the regular AnthropicChatProvider that POSTs to
   * /api/ai/chat with x-api-key.
   *
   * Non-Anthropic provider ids ignore this option entirely.
   */
  authKind?: "oauth" | "api-key";
};

export function getChatProvider(
  id: ProviderId,
  opts?: GetChatProviderOpts,
): ChatProvider {
  // OAuth provider is intentionally NOT inserted into chatCache: that cache
  // is keyed by ProviderId, and stuffing the OAuth singleton under
  // "anthropic" would silently break callers that want the api-key path.
  // The OAuth singleton is owned by getAnthropicOAuthChatProvider().
  if (id === "anthropic" && opts?.authKind === "oauth") {
    return getAnthropicOAuthChatProvider();
  }

  let p = chatCache.get(id);
  if (p) return p;
  p = constructChatProvider(id);
  chatCache.set(id, p);
  return p;
}

export function getEmbedProvider(id: ProviderId): EmbedProvider {
  let p = embedCache.get(id);
  if (p) return p;
  p = constructEmbedProvider(id);
  embedCache.set(id, p);
  return p;
}

export function listChatProviderIds(): ProviderId[] {
  return Array.from(chatCache.keys());
}

export function listEmbedProviderIds(): ProviderId[] {
  return Array.from(embedCache.keys());
}
