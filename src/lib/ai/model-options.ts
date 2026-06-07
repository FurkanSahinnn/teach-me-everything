// Settings UI must not import the full registry — it only needs the projected
// option shape. Keeping this in a pure helper means tests can pin exact option
// ordering without spinning up React.

import {
  listResearchPresets,
  RESEARCH_PRESETS,
} from "@/lib/research/providers/presets";
import type {
  ResearchPreset,
  ResearchProviderId,
} from "@/lib/research/providers/types";
import { getWebSearchAdapter } from "./web-search/adapter";
import type { WebSearchCapability } from "./web-search/types";
import { PRICING } from "./pricing";
import {
  listEmbedPresets,
  type EmbedPreset,
  type EmbedPresetId,
} from "./providers/embed-presets";
import { isLocalUrl } from "./providers/local-bypass";
import { getPreset, listPresets } from "./providers/presets";
import type {
  ModelDescriptor,
  ModelTier,
  ProviderId,
  ProviderPreset,
} from "./providers/types";

const CHAT_BINDING_SEPARATOR = "::";

export type CapabilityBadge =
  | { kind: "free"; label: "🆓 Free" }
  | { kind: "tool"; label: "🛠 Tool" }
  | { kind: "cache"; label: "🧠 Cache" }
  | { kind: "vision"; label: "👁 Vision" }
  | { kind: "local"; label: "🏠 Local" }
  | { kind: "js-render"; label: "🪞 JS" }
  | { kind: "search"; label: "🔎 Search" }
  | { kind: "dim"; label: string };

export type ResearchOption = {
  id: ResearchProviderId;
  label: string;
  presetId: ResearchProviderId;
  badges: CapabilityBadge[];
  hint?: string;
};

export type ChatOption = {
  id: string;
  modelId: string;
  label: string;
  presetId: ProviderId;
  badges: CapabilityBadge[];
  hint?: string;
  // Phase 5.5 — `true` when this provider/model pair supports a native web
  // search tool (Claude `web_search_20260209`, OpenAI Responses, Gemini,
  // Perplexity Sonar, Grok, Mistral Agents, OpenRouter `:online`). 5.5.A
  // ships the capability shape but every option is `false` until the
  // per-provider adapters land in 5.5.B; the reader toggle and Settings
  // badge read this flag at render time, so flipping a provider on later
  // is a one-line change.
  supportsWebSearch: boolean;
  webSearchCapability?: WebSearchCapability | undefined;
};

export type EmbedOption = {
  id: EmbedPresetId | string;
  label: string;
  presetId: EmbedPresetId | string;
  badges: CapabilityBadge[];
  hint?: string;
  // Retired/deprecated provider model — the Settings picker hides it from new
  // selections (but still shows it when it's the currently-bound value).
  deprecated?: boolean;
};

export function badgesForChat(preset: ProviderPreset): CapabilityBadge[] {
  const badges: CapabilityBadge[] = [];
  if (preset.freeTier === true) badges.push({ kind: "free", label: "🆓 Free" });
  if (preset.capabilities.toolUse !== "none") {
    badges.push({ kind: "tool", label: "🛠 Tool" });
  }
  if (preset.capabilities.cacheControl) {
    badges.push({ kind: "cache", label: "🧠 Cache" });
  }
  if (preset.capabilities.vision) {
    badges.push({ kind: "vision", label: "👁 Vision" });
  }
  if (isLocalUrl(preset.baseUrl)) {
    badges.push({ kind: "local", label: "🏠 Local" });
  }
  return badges;
}

export function badgesForEmbed(preset: EmbedPreset): CapabilityBadge[] {
  const badges: CapabilityBadge[] = [];
  if (preset.freeTier) badges.push({ kind: "free", label: "🆓 Free" });
  const dimLabel = Array.isArray(preset.dim)
    ? `${preset.dim.join("/")}-d`
    : `${preset.dim}-d`;
  badges.push({ kind: "dim", label: dimLabel });
  if (preset.isLocal === true || isLocalUrl(preset.baseUrl)) {
    badges.push({ kind: "local", label: "🏠 Local" });
  }
  return badges;
}

export function badgesForResearch(preset: ResearchPreset): CapabilityBadge[] {
  const badges: CapabilityBadge[] = [];
  if (preset.capabilities.freeTier) badges.push({ kind: "free", label: "🆓 Free" });
  if (preset.capabilities.local) badges.push({ kind: "local", label: "🏠 Local" });
  if (preset.capabilities.jsRender) badges.push({ kind: "js-render", label: "🪞 JS" });
  if (preset.capabilities.search) badges.push({ kind: "search", label: "🔎 Search" });
  return badges;
}

function chatOrderRank(preset: ProviderPreset): number {
  // native-tool first, json-tool second, custom: last (handled before this
  // ranks). toolUse "none" sits between json and custom so degraded-but-valid
  // presets still appear in non-tool-required pickers.
  const id = String(preset.id);
  if (id.startsWith("custom:")) return 9;
  if (preset.capabilities.toolUse === "native") return 0;
  if (preset.capabilities.toolUse === "json") return 1;
  return 2;
}

export function encodeChatModelBinding(
  presetId: ProviderId,
  modelId: string,
): string {
  return `${presetId}${CHAT_BINDING_SEPARATOR}${modelId}`;
}

function decodeChatModelBinding(
  value: string,
): { presetId: ProviderId; modelId: string } | null {
  const idx = value.indexOf(CHAT_BINDING_SEPARATOR);
  if (idx <= 0) return null;
  const presetId = value.slice(0, idx) as ProviderId;
  const modelId = value.slice(idx + CHAT_BINDING_SEPARATOR.length);
  if (!modelId) return null;
  return { presetId, modelId };
}

export function listChatOptions(opts?: {
  requireToolUse?: boolean;
}): ChatOption[] {
  const requireToolUse = opts?.requireToolUse === true;
  const presets = listPresets()
    .filter((p) => p.kind === "chat" || p.kind === "both")
    .filter((p) => !String(p.id).startsWith("custom:"))
    .filter((p) => (requireToolUse ? p.capabilities.toolUse !== "none" : true))
    .slice()
    .sort((a, b) => {
      const ra = chatOrderRank(a);
      const rb = chatOrderRank(b);
      if (ra !== rb) return ra - rb;
      return a.label.localeCompare(b.label);
    });

  return presets.map((p) => {
    const modelId = p.defaultModels.chat ?? String(p.id);
    const adapter = getWebSearchAdapter(p.id);
    return {
      id: encodeChatModelBinding(p.id, modelId),
      modelId,
      label: `${p.label} · ${modelId}`,
      presetId: p.id,
      badges: badgesForChat(p),
      // 5.5.B — `supportsWebSearch` is derived from the adapter registry so
      // adding/removing a provider in `lib/ai/web-search/adapter.ts` flips
      // the reader toggle automatically. Adapters publish their capability
      // shape (paramsSupported, pricing); we propagate it onto the option
      // for the Settings panel + cost preview.
      supportsWebSearch: adapter !== null,
      ...(adapter ? { webSearchCapability: adapter.capability } : {}),
    };
  });
}

export function listEmbedOptions(): EmbedOption[] {
  return listEmbedPresets().map((p) => ({
    id: p.id,
    label: `${p.label}`,
    presetId: p.id,
    badges: badgesForEmbed(p),
    ...(p.deprecated ? { deprecated: true } : {}),
  }));
}

/**
 * Settings → Models tab projects this list as the research provider row.
 * Sort: local first (readability), then by label so cloud providers stay
 * deterministic regardless of registry insertion order.
 */
export function listResearchOptions(): ResearchOption[] {
  return listResearchPresets()
    .slice()
    .sort((a, b) => {
      if (a.kind === "local" && b.kind !== "local") return -1;
      if (a.kind !== "local" && b.kind === "local") return 1;
      return a.label.localeCompare(b.label);
    })
    .map((p) => ({
      id: p.id,
      label: p.label,
      presetId: p.id,
      badges: badgesForResearch(p),
    }));
}

/** Resolve a stored researchProvider binding back to its option. */
export function findResearchOption(id: string): ResearchOption | undefined {
  const preset = RESEARCH_PRESETS[id as ResearchProviderId];
  if (!preset) return undefined;
  return {
    id: preset.id,
    label: preset.label,
    presetId: preset.id,
    badges: badgesForResearch(preset),
  };
}

/**
 * Resolve a stored modelBindings string (e.g. "claude-sonnet-4-6") to its
 * full ChatOption — including the providerId callers need to pick the right
 * adapter. Returns undefined when the model is no longer in the registry
 * (e.g. user-stored value from a removed preset).
 */
export function findChatOption(modelId: string): ChatOption | undefined {
  const options = listChatOptions();
  const decoded = decodeChatModelBinding(modelId);
  if (decoded) {
    const provider = options.find((o) => o.presetId === decoded.presetId);
    if (!provider) return undefined;
    return {
      ...provider,
      id: encodeChatModelBinding(decoded.presetId, decoded.modelId),
      modelId: decoded.modelId,
      label: `${provider.label.split(" · ")[0]} · ${decoded.modelId}`,
    };
  }
  const legacyProviderScoped = options.find((o) =>
    modelId.startsWith(`${o.presetId}:`),
  );
  if (legacyProviderScoped) {
    const scopedModelId = modelId.slice(`${legacyProviderScoped.presetId}:`.length);
    return {
      ...legacyProviderScoped,
      id: encodeChatModelBinding(
        legacyProviderScoped.presetId,
        scopedModelId,
      ),
      modelId: scopedModelId,
      label: `${legacyProviderScoped.label.split(" · ")[0]} · ${scopedModelId}`,
    };
  }
  return (
    options.find((o) => o.id === modelId) ??
    options.find((o) => o.modelId === modelId)
  );
}

/**
 * Curated model catalog for a provider. Falls back to a single descriptor
 * built from `defaultModels.chat` so local providers and custom endpoints
 * still surface something in the model dropdown.
 */
export function getProviderChatModels(
  presetId: ProviderId,
): ModelDescriptor[] {
  const preset = getPreset(presetId);
  if (!preset) return [];
  if (preset.availableModels && preset.availableModels.length > 0) {
    return preset.availableModels;
  }
  const fallbackId = preset.defaultModels.chat;
  if (!fallbackId) return [];
  return [
    { id: fallbackId, displayName: fallbackId, tier: "balanced" },
  ];
}

export function findModelDescriptor(
  presetId: ProviderId,
  modelId: string,
): ModelDescriptor | undefined {
  return getProviderChatModels(presetId).find((m) => m.id === modelId);
}

export const MODEL_TIER_LABEL: Record<ModelTier, { tr: string; en: string }> = {
  flagship: { tr: "Flagship", en: "Flagship" },
  balanced: { tr: "Dengeli", en: "Balanced" },
  fast: { tr: "Hızlı", en: "Fast" },
  free: { tr: "Ücretsiz", en: "Free" },
};

/**
 * Compact USD-per-1M-input-tokens label for a model. Used as a price chip
 * next to the model name. Returns "Free" for zero-cost models (free tier or
 * local) and `null` when pricing is unknown so callers can hide the chip.
 */
export function formatModelPriceLabel(modelId: string): string | null {
  const price = PRICING[modelId];
  if (!price) return null;
  if (price.input === 0 && price.output === 0) return "Free";
  // Always show cents — rounding $3.50 → "$4/M" mislabels several models.
  return `$${price.input.toFixed(2)}/M`;
}
