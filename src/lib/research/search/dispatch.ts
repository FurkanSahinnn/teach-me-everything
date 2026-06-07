// Phase 5.5.G — Search dispatcher with fallback chain.
//
// Walks the user's priority list top-down. For each entry, in order:
//   (1) skip if `enabled === false`
//   (2) skip if the provider id is unknown (forward-compat / stale prefs)
//   (3) skip if no API key is stored for the provider's auth slot
//   (4) try `.search(...)`; on success return immediately
//   (5) on error, record + advance to next entry
//
// Every attempt is captured in `attempted[]` so the caller can surface a
// useful diagnostic ("Brave: 429 rate-limited → Exa: success" beats a flat
// "search failed").

import { getApiKey } from "@/lib/db/api-keys-repo";
import { getSearchProvider } from "./registry";
import {
  getKeyProvidersForSearch,
  type SearchAuthKind,
  type SearchProviderEntry,
  type SearchProviderId,
  type SearchResultItem,
} from "./types";

export type SearchAttemptStatus =
  | "skipped-disabled"
  | "skipped-unknown"
  | "skipped-no-key"
  | "skipped-empty"
  | "error"
  | "ok";

export type SearchAttempt = {
  id: string;
  status: SearchAttemptStatus;
  error?: string;
};

/**
 * Fired right before a provider's `.search()` is awaited — i.e. only for
 * entries that survived every skip gate (disabled / unknown / no-key /
 * credential-resolution-error). `attemptIndex` is 1-based and counts ONLY
 * the real attempts, so the UI can pair it with its own "live chain"
 * length to render a determinate progress bar (`attemptIndex / total`).
 */
export type SearchAttemptInfo = {
  id: SearchProviderId | string;
  label: string;
  attemptIndex: number;
};

export type SearchDispatchInput = {
  query: string;
  count?: number | undefined;
  signal?: AbortSignal | undefined;
  /** Ordered priority list from `prefs.searchProviders`. */
  providers: SearchProviderEntry[];
  /**
   * Optional progress hook. Called once per provider that the dispatcher
   * actually probes (skipped entries don't fire). Used by the UI to drive
   * a determinate progress bar — see `SearchSourcesModal`.
   */
  onAttempt?: (info: SearchAttemptInfo) => void;
};

export type SearchDispatchResult = {
  /** The provider that produced this result list. */
  providerId: SearchProviderId | string;
  results: SearchResultItem[];
  attempted: SearchAttempt[];
};

export class SearchDispatchError extends Error {
  readonly attempted: SearchAttempt[];
  constructor(message: string, attempted: SearchAttempt[]) {
    super(message);
    this.name = "SearchDispatchError";
    this.attempted = attempted;
  }
}

/**
 * Run the search through the priority chain. Returns the first non-empty
 * result list; throws `SearchDispatchError` (with the full attempt trace) if
 * no provider produced results.
 *
 * A provider that returns an empty array is treated as "no hits" — we
 * advance to the next entry rather than treating it as success. This means
 * a flaky upstream that returns 0 results won't shadow a working backup.
 */
export async function searchWithFallback(
  input: SearchDispatchInput,
): Promise<SearchDispatchResult> {
  const attempted: SearchAttempt[] = [];
  let attemptCounter = 0;

  for (const entry of input.providers) {
    if (!entry.enabled) {
      attempted.push({ id: entry.id, status: "skipped-disabled" });
      continue;
    }

    const provider = getSearchProvider(entry.id);
    if (!provider) {
      attempted.push({ id: entry.id, status: "skipped-unknown" });
      continue;
    }

    const credentialOptions = getKeyProvidersForSearch(entry.id);
    if (credentialOptions.length === 0) {
      attempted.push({ id: entry.id, status: "skipped-unknown" });
      continue;
    }

    // Walk every credential option for this provider (e.g. Anthropic has two:
    // plain api-key and Claude Code OAuth). Use the first slot that returns
    // a stored key. Errors from `getApiKey` (rare — credential-store failure)
    // are surfaced as the entry's error and we move to the next chain entry.
    let apiKey: string | null = null;
    let authKind: SearchAuthKind = "api-key";
    let resolutionError: string | null = null;
    for (const option of credentialOptions) {
      try {
        const key = await getApiKey(option.keyProvider);
        if (key) {
          apiKey = key;
          authKind = option.authKind;
          break;
        }
      } catch (err) {
        resolutionError = err instanceof Error ? err.message : String(err);
        break;
      }
    }
    if (resolutionError !== null) {
      attempted.push({
        id: entry.id,
        status: "error",
        error: resolutionError,
      });
      continue;
    }
    if (!apiKey) {
      attempted.push({ id: entry.id, status: "skipped-no-key" });
      continue;
    }

    try {
      const searchOpts: {
        query: string;
        apiKey: string;
        authKind?: SearchAuthKind;
        count?: number;
        signal?: AbortSignal;
      } = { query: input.query, apiKey, authKind };
      if (input.count !== undefined) searchOpts.count = input.count;
      if (input.signal !== undefined) searchOpts.signal = input.signal;
      attemptCounter += 1;
      input.onAttempt?.({
        id: provider.id,
        label: provider.label,
        attemptIndex: attemptCounter,
      });
      const results = await provider.search(searchOpts);
      if (results.length === 0) {
        attempted.push({ id: entry.id, status: "skipped-empty" });
        continue;
      }
      attempted.push({ id: entry.id, status: "ok" });
      return { providerId: provider.id, results, attempted };
    } catch (err) {
      attempted.push({
        id: entry.id,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      // continue to next provider
    }
  }

  throw new SearchDispatchError(
    "All configured search providers failed or are unavailable.",
    attempted,
  );
}
