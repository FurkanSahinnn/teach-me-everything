/**
 * Phase 6.9.5 — Production embedder factory.
 *
 * Resolves an `EmbedderHandle` from the user's prefs. The notes route + auto-
 * sync timer both call this to obtain the active embedder before invoking
 * `embedNoteAsSource(...)`. Stays free of React hooks so the auto-sync
 * `setTimeout` callback can call it directly without violating the rules of
 * hooks.
 *
 * Resolution order:
 *   1. read `prefs.modelBindings.embedPresetId`
 *   2. look up `EMBED_PRESETS[id]` (falls back to `openai-3-small` for
 *      forward-compat with future preset additions)
 *   3. map preset → providerId via `presetToProviderId(...)`
 *   4. obtain the concrete `EmbedProvider` from the registry
 *   5. if the preset is local (Ollama, LAN endpoints), hand the provider an
 *      empty api key — local adapters accept that
 *   6. otherwise: a key must be stored AND `getApiKey(...)` must return a
 *      non-empty string
 *   7. wrap the provider + key into an `EmbedderHandle` whose `embed(inputs)`
 *      delegates to `provider.embed({apiKey, model, inputs}).vectors`
 *
 * Returns `{ handle: null, reason }` when prerequisites are missing so the
 * caller can surface a precise toast. Pre-Phase-9 the resolution also gated
 * on `useVault.isUnlocked`; the master-password vault is gone now, so the
 * `vault-locked` reason is retained in the union only as a deprecated stub
 * for stale callers and is never returned.
 */

import { PRICING } from "@/lib/ai/pricing";
import {
  EMBED_PRESETS,
  type EmbedPresetId,
} from "@/lib/ai/providers/embed-presets";
import { isLocalUrl } from "@/lib/ai/providers/local-bypass";
import { getEmbedProvider } from "@/lib/ai/providers/registry";
import type { EmbedProvider } from "@/lib/ai/providers/types";
import { getApiKey } from "@/lib/db/api-keys-repo";
import type { Provider } from "@/lib/db/schema";
import { presetToProviderId } from "@/lib/ingest/reembed";
import { usePrefs } from "@/stores/prefs";
import type { EmbedderHandle } from "./embed-as-source";

export type EmbedderResolutionFailure =
  | "unknown-preset"
  /** @deprecated Phase 9 — never returned; kept for stale-call compatibility. */
  | "vault-locked"
  | "no-key"
  | "provider-unavailable";

export type EmbedderResolution =
  | { handle: EmbedderHandle; reason: null }
  | { handle: null; reason: EmbedderResolutionFailure };

/**
 * Test seam — accepts the preset id as a parameter so unit tests can pass
 * a synthetic prefs snapshot without touching the actual Zustand singletons.
 * Production callers use `resolveEmbedderFromPrefs()` which reads from the
 * live store.
 */
export async function resolveEmbedderFromState(input: {
  presetId: string;
  /** Test seam — override the provider registry / key lookup in unit tests. */
  getProvider?: (providerId: string) => EmbedProvider;
  getKey?: (provider: Provider) => Promise<string | null>;
}): Promise<EmbedderResolution> {
  const preset =
    EMBED_PRESETS[input.presetId as EmbedPresetId] ??
    EMBED_PRESETS["openai-3-small"];
  if (!preset) return { handle: null, reason: "unknown-preset" };

  const providerId = presetToProviderId(preset.id);
  if (!providerId) return { handle: null, reason: "unknown-preset" };

  let provider: EmbedProvider;
  try {
    provider = (input.getProvider ?? getEmbedProvider)(providerId);
  } catch {
    return { handle: null, reason: "provider-unavailable" };
  }

  const isLocal = preset.isLocal === true || isLocalUrl(preset.baseUrl);
  let apiKey = "";
  if (!isLocal) {
    let stored: string | null;
    try {
      stored = await (input.getKey ?? getApiKey)(providerId as Provider);
    } catch {
      stored = null;
    }
    if (!stored || stored.length === 0) {
      return { handle: null, reason: "no-key" };
    }
    apiKey = stored;
  }

  // Pricing is keyed on the upstream model string, not the preset id. The
  // `input` field is already dollars per million input tokens — exactly
  // what `EmbedderHandle.pricePerMillionTokensUsd` expects. Unknown models
  // map to 0 so free-tier / local presets read as cost-free downstream.
  const pricePerMillionTokensUsd = PRICING[preset.model]?.input ?? 0;

  const handle: EmbedderHandle = {
    providerId,
    model: preset.model,
    pricePerMillionTokensUsd,
    async embed(inputs: string[]): Promise<Float32Array[]> {
      const result = await provider.embed({
        apiKey,
        model: preset.model,
        inputs,
      });
      return result.vectors;
    },
  };
  return { handle, reason: null };
}

/**
 * Production entry — reads the live `usePrefs` snapshot and resolves the
 * embedder. Designed to be called from event handlers / setTimeout callbacks;
 * safe to invoke outside React render.
 */
export async function resolveEmbedderFromPrefs(): Promise<EmbedderResolution> {
  const { embedPresetId } = usePrefs.getState().modelBindings;
  return resolveEmbedderFromState({
    presetId: embedPresetId,
  });
}
