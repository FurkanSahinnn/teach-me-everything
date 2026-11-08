// OpenCode CLI catalog adapter — not an HTTP endpoint.
//
// Opens a throwaway `opencode acp` session and reads its model option, which
// lists the models of every provider the user connected inside OpenCode
// (OpenCode Zen/Go, their own keys, local servers). No prompt is sent.
//
// `baseUrl` / `apiKey` are ignored; the CLI path comes from prefs. Resolves to
// an empty list on the web build, when the CLI is missing, or on timeout, and
// the hook falls back to the preset's "OpenCode default" entry.

import { listOpencodeModels } from "../opencode-cli";
import type { ModelFetchAdapter, ModelFetchOptions, ModelFetchResult } from "./types";

export const OPENCODE_CLI_MODEL_FETCH_ADAPTER: ModelFetchAdapter = {
  providerId: "opencode-cli",
  requiresApiKey: false,
  endpointLabel: "opencode acp session/new",
  async fetch(opts: ModelFetchOptions): Promise<ModelFetchResult> {
    const models = await listOpencodeModels({ signal: opts.signal });
    return { models, fetchedFrom: "opencode acp" };
  },
};
