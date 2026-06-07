// Maps a ResearchProviderId to its api-keys-repo Provider literal. Returns
// null for readability (no key needed). Centralised so the AddUrlModal and
// settings UI agree on where each key is stored.

import { getApiKey } from "@/lib/db/api-keys-repo";
import type { ApiKeyProvider } from "@/lib/db/schema";
import type { ResearchProviderId } from "./providers/types";

const KEY_MAP: Record<ResearchProviderId, ApiKeyProvider | null> = {
  readability: null,
  firecrawl: "firecrawl",
  exa: "exa",
  "jina-reader": "jina",
  tavily: "tavily",
  diffbot: "diffbot",
  brightdata: "brightdata",
};

/** True when the provider talks to a cloud API and needs a stored key. */
export function researchProviderRequiresKey(id: ResearchProviderId): boolean {
  return KEY_MAP[id] !== null;
}

/** Resolve the underlying ApiKeyProvider used for storage, or null. */
export function researchKeyProvider(
  id: ResearchProviderId,
): ApiKeyProvider | null {
  return KEY_MAP[id];
}

/**
 * Return the API key for the given research provider. Returns null for
 * keyless providers (readability) and when no key has been stored.
 */
export async function resolveResearchCredential(
  id: ResearchProviderId,
): Promise<string | null> {
  const keyProvider = KEY_MAP[id];
  if (keyProvider === null) return null;
  return getApiKey(keyProvider);
}
