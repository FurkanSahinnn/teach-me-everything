import { getApiKey } from "@/lib/db/api-keys-repo";
import { type Provider } from "@/lib/db/schema";
import { usePrefs } from "@/stores/prefs";
import type { ProviderId } from "@/lib/ai/providers/types";

export type AnthropicAuthKind = "oauth" | "api-key";

export type AnthropicCredential = {
  key: string;
  kind: AnthropicAuthKind;
};

/**
 * Resolved credential for any chat preset, normalised so the caller can pass
 * `apiKey` + (optionally) `authKind` straight into ChatRequest without
 * re-doing the Anthropic-vs-others branch at every call site. Non-Anthropic
 * presets always come back with `authKind: undefined`.
 */
export type ChatCredential = {
  apiKey: string;
  authKind?: AnthropicAuthKind;
};

/**
 * Resolve which Anthropic credential to use for a chat call, honouring the
 * user's `preferredAnthropicAuth` + `strictAnthropicAuth` settings:
 *
 *  - preferred=oauth, strict=false → try OAuth first, fall back to API key
 *  - preferred=oauth, strict=true  → OAuth only (fail if missing/invalid)
 *  - preferred=api-key, strict=false → try API key first, fall back to OAuth
 *  - preferred=api-key, strict=true  → API key only (fail if missing/invalid)
 *
 * Returns `null` when no credential is available under the resolved policy.
 */
export async function resolveAnthropicCredential(): Promise<AnthropicCredential | null> {
  const { preferredAnthropicAuth, strictAnthropicAuth } = usePrefs.getState();

  const order: AnthropicAuthKind[] =
    preferredAnthropicAuth === "oauth"
      ? ["oauth", "api-key"]
      : ["api-key", "oauth"];

  for (const kind of order) {
    const provider = kind === "oauth" ? "claude-code-oauth" : "anthropic";
    let key: string | null = null;
    try {
      key = await getApiKey(provider);
    } catch {
      key = null;
    }
    if (key) return { key, kind };
    if (strictAnthropicAuth) return null;
  }
  return null;
}

/**
 * Resolve the credential to use for any chat preset. For "anthropic" this
 * delegates to resolveAnthropicCredential() so OAuth ↔ API-key preference
 * + strict mode stay honoured. For every other preset this falls through
 * to a plain getApiKey() lookup keyed by the preset id.
 *
 * Returns null when nothing usable is on file. Throws nothing — error
 * messaging is the caller's job (each call site has its own copy).
 */
export async function resolveChatCredentialForPreset(
  presetId: ProviderId,
): Promise<ChatCredential | null> {
  if (presetId === "anthropic") {
    const cred = await resolveAnthropicCredential();
    if (!cred) return null;
    return { apiKey: cred.key, authKind: cred.kind };
  }
  let key: string | null = null;
  try {
    key = await getApiKey(presetId as Provider);
  } catch {
    key = null;
  }
  if (!key) return null;
  return { apiKey: key };
}
