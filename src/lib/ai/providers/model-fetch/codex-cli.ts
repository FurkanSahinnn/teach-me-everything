// Codex CLI catalog adapter — not an HTTP endpoint.
//
// Asks the local `codex app-server` (JSON-RPC over stdio) for `model/list`,
// which reflects what the signed-in ChatGPT account may actually use. That
// matters more here than for any cloud provider: the account, not the binary,
// decides — a ChatGPT login rejects `gpt-5` outright — so a static list can
// only ever be a stale guess.
//
// `baseUrl` / `apiKey` are ignored; the CLI path comes from prefs. Resolves to
// an empty list on the web build, when the CLI is missing, or on timeout, and
// the hook falls back to the preset snapshot.

import { listCodexModels } from "../codex-cli";
import type { ModelFetchAdapter, ModelFetchOptions, ModelFetchResult } from "./types";

export const CODEX_CLI_MODEL_FETCH_ADAPTER: ModelFetchAdapter = {
  providerId: "codex-cli",
  requiresApiKey: false,
  endpointLabel: "codex app-server model/list",
  async fetch(opts: ModelFetchOptions): Promise<ModelFetchResult> {
    const models = await listCodexModels({ signal: opts.signal });
    return { models, fetchedFrom: "codex app-server" };
  },
};
