# Backend codemap

The app has no server database. "Backend" here is (1) the `src/app/api/ai/*` route handlers used by the web dev server, (2) the provider/AI/ingest logic in `src/lib/`, which runs in the browser or webview, and (3) the Rust side in `src-tauri/`. See [architecture](architecture.md) for runtime modes and [PROVIDERS](../PROVIDERS.md) / [PROVIDERS_LOCAL](../PROVIDERS_LOCAL.md) for provider details.

## Route handlers: `src/app/api/ai/*` (web dev only; not built in static export)

| Route | Runtime | Role |
|---|---|---|
| `chat/route.ts` | edge | Chat proxy for anthropic / openai-compat / gemini families; request building in `lib/ai/upstream/chat-request.ts` (`buildChatUpstream`) |
| `chat-responses/route.ts` | edge | OpenAI Responses API proxy (native `web_search`); `upstream/responses-request.ts` |
| `chat-oauth/route.ts` | nodejs | Anthropic OAuth chat through `@anthropic-ai/claude-agent-sdk`; `upstream/oauth-request.ts` |
| `embed/route.ts` | edge | Embedding proxy; `upstream/embed-request.ts`, `embed-fetch.ts` |
| `test/route.ts` | nodejs | Key / connectivity test per provider |
| `research/route.ts` | nodejs | CORS-bypass fetch for the readability extractor, with private-host (SSRF) guard |
| `research/youtube/route.ts` | nodejs | YouTube transcript via `youtube-transcript` |

## `src/lib/ai/`

- **Providers** (`providers/`): `types.ts` (`ProviderId`, `ProviderFamily` = anthropic | openai-compat | gemini | agent-cli, `ChatProvider`, `EmbedProvider`, `StreamEvent`); `presets.ts` (`PROVIDER_PRESETS`, `getPreset`); `registry.ts` (`getChatProvider`, `getEmbedProvider`, `listChatProviderIds`); implementations `anthropic.ts`, `anthropic-oauth.ts`, `openai-compat.ts`, `openai-responses.ts`, `gemini.ts` (+ `gemini-retry.ts`), `claude-cli.ts`, `codex-cli.ts`, `codex-app-server.ts`, `opencode-cli.ts` (provider, ACP catalog), `opencode-acp.ts` (ACP streaming); `tool-translator.ts`; `local-bypass.ts` (`isLocalUrl`).
- **Embeddings:** `providers/embed-presets.ts` (`EMBED_PRESETS`) and `embed-{openai,openai-compat,gemini,cohere,jina,voyage,hf}.ts`.
- **Model lists:** `providers/model-fetch/` (`getModelFetchAdapter`, per-provider adapters, `tier-infer.ts`); cached in Dexie `providerModelsCache`. `model-options.ts`, `quick-start-presets.ts`, `context-window.ts`, `pricing.ts` (`computeCostUsd`).
- **Web search:** `providers/web-search/` per-provider request/parse adapters (claude, gemini, glm, mistral, openai-responses, openrouter, perplexity, xai) selected via `web-search/adapter.ts` (`getWebSearchAdapter`, `supportsWebSearch`).
- **Credentials:** `anthropic-credential.ts` (`resolveChatCredentialForPreset`, `presetIsKeyless`; use it instead of `isLocalUrl` for agent-cli presets, which have an empty `baseUrl`).
- **Agent CLI status:** `agent-status/` (`probeClaudeStatus`, `probeCodexStatus`, parsers for Claude `initialize`/`get_usage` and Codex `account/read`/`account/rateLimits/read`, `useAgentStatus` store with a 5-minute TTL). `provider-catalog.ts` (`buildProviderCatalog`, `filterEnabledChatOptions`) feeds Settings → Providers.
- **Runners** (`runners/`): request ownership outside React. `chat-session.ts` (`ChatSession`, `useChatSession`), `stream-writer.ts` (`createStreamWriter`), `workspace-chat-runner.ts` (`useWorkspaceChat`), `article-analysis-runner.ts` (`useArticleAnalysisRunner`).
- **Staged pipelines:** `stage-runner.ts` (`callStage`, `runWithRetry`, `mapWithConcurrency`, `resolveModelBindings`, `StageError` family); `article-analysis.ts` (`runArticleAnalysis`, `MAP_CONCURRENCY`).
- **Generators:** `quiz-gen`, `quiz-eval`, `flashcard-gen`, `roadmap-gen`, `curriculum-generation`, `lesson-note-generation`, `study-journal-generation`, `podcast-generation`, `concept-extraction`, `cross-analysis`, `translate`. Prompts live in `prompts/` (one file per feature, plus `chat-guidance.ts`).
- **Chat context / tools:** `context/` (`gatherContextBlocks`, `budget.ts`, blocks for concepts, notes, performance, roadmap); `tools.ts` (`buildNotebookTools`, `buildWorkspaceTools`) and `tool-handlers.ts`; `retrieval.ts` (`topKChunks`, `cosineSim`) with `retrieval/fallback.ts`.
- **Egress:** `csp-origins.ts` (`SEED_ORIGINS`, `deriveConnectOrigins`; relative imports because `next.config.ts` loads it).

## Other `src/lib/` backends

- `research/`: `ingest.ts` (`ingestResearchUrl`, `fetchResearchContent`), `url-classifier.ts` (`classifyUrl`), `arxiv-fetch.ts`, `doi-fetch.ts`, `youtube-fetch.ts`, `synthesis.ts` (`runSynthesis`), `credential.ts`; `providers/` extractors (readability, firecrawl, exa, jina-reader, tavily, diffbot, brightdata; `registry.ts`, `presets.ts`); `search/` (`searchWithFallback` in `dispatch.ts`, brave, exa, tavily, `chat-llm-search.ts`).
- `ingest/`: `pdf.ts` + `pdf-worker.ts`, `docx.ts` + `docx-worker.ts` + `docx-html.ts`, `chunker.ts` (`chunkPages`), `embed.ts` (`embedSourceChunks`), `reembed.ts`, `rechunk.ts`, `ingest-pdf-source.ts`.
- `usage/`: `aggregateUsage` (totals, provider/model shares, daily token and cost series, cost by type, unpriced models), `rangeToSinceMs`, `lookupPricing`/`costFor`; bridge `src/lib/tauri/usage.ts` (`scanUsage`).
- `podcast/`: `adapter.ts` (`TtsAdapter`, `registerAdapter`), `adapters/{piper,web-speech,experimental-local}.ts`, `synthesize.ts` (`synthesizePodcastAudio`), `audio-assembly.ts`, `compatibility.ts`, `install.ts`, `voices.ts`.
- `tauri/`: `env.ts` (`isTauriEnvWithOverride`), `fetch.ts` (`tauriFetch`, `smartFetch`), `agent-cli.ts` (`probeAgentCli`, `startAgentCli`, `writeAgentCli`, `stopAgentCli`, `getAgentWorkspace`), `sysinfo.ts`. `crypto/keychain.ts` wraps the `keychain_*` commands.

## Rust: `src-tauri/src/`

| File | Contents |
|---|---|
| `main.rs` | Entry; calls `tme_lib::run` |
| `lib.rs` | `run()`: registers plugins (http, fs, dialog, notification, autostart, updater, process, opener, shell), `generate_handler!` for 15 commands, tray and app menu, file-open events; `serve_export_asset` + `export_shell_fallback` with `DYN_PARENTS` (audio, read, study, roadmap, analysis) for the static-export shell |
| `agent_cli.rs` | `agent_cli_probe`, `agent_cli_start`, `agent_cli_write`, `agent_cli_stop`, `agent_cli_workspace`; `AgentCliState` session map; stdout lines pushed over a `tauri::ipc::Channel` |
| `agent_process.rs` | `ProcessTree`: Windows job object / Unix process-group ownership so the whole CLI tree is killed |
| `keychain.rs` | `keychain_get/set/delete/list` over the `keyring` crate |
| `tts.rs` | `tts_piper_check_readiness`, `tts_piper_synthesize`, `tts_list_installed_voices`, `tts_install_voice`, `tts_delete_voice` (Piper via shell plugin; model download via reqwest) |
| `sysinfo.rs` | `sysinfo_probe`, `sysinfo_gpu` |
| `usage.rs` | `usage_scan` (read-only scan of Claude Code / Codex session logs, `.jsonl` and `.jsonl.zst` via `ruzstd`; per-file `UsageCache`; returns per-day, per-model token sums) |

Permissions: each custom command needs an `allow-*` entry in `src-tauri/permissions/{agent-cli,keychain,sysinfo,tts}.toml` and that identifier listed in `src-tauri/capabilities/default.json`; otherwise `invoke` is rejected. The same capability file holds plugin permissions (fs scope limited to `$HOME`, `$DOCUMENT`, `$DESKTOP`) and the `http:default` URL allow list, which must be extended by hand for new cloud hosts.
