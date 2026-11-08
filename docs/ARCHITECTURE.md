# Architecture — Teach Me Everything

How the app is put together and why. File-level maps live in [CODEMAPS/](CODEMAPS/architecture.md);
per-page behaviour in [FEATURES.md](FEATURES.md).

## 1. Shape of the system

TME is a client-heavy Next.js App Router app with no server-side state. Everything the user owns lives in
IndexedDB (Dexie) on their machine; AI calls go straight from the client to the provider the user configured.

It runs in two modes:

| | Web (development only) | Desktop (the shipped product) |
|---|---|---|
| Build | `npm run dev` / `npm run build` | `npm run build:export` (`NEXT_OUTPUT_EXPORT=true` → `output: "export"`), wrapped by Tauri |
| Server | Next dev server; `src/app/api/ai/*` route handlers act as LLM proxies | none — static files served by the Tauri asset resolver |
| Upstream HTTP | browser `fetch` → same-origin `/api/ai/*` → provider | `tauriFetch` (`@tauri-apps/plugin-http`) → provider directly |
| API keys | Dexie, plaintext (dev convenience) | OS keychain through Rust (`src-tauri/src/keychain.rs`) |
| Local CLIs | not available | `claude` / `codex` / `opencode` spawned by Rust (`src-tauri/src/agent_cli.rs`) |

The switch is `isTauriEnvWithOverride()` in `src/lib/tauri/env.ts` (the override is a test seam; use it, not
`isTauriEnv()`, for production gating). There is no cloud deployment: releases are Tauri installers on GitHub
Releases (§10).

## 2. Layers

```
src/app/**                 routes (thin pages; read params via useRouteParams under /w/[id])
  └─ src/components/<domain>/   UI by domain (notebook, notes, roadmap, article-analysis, settings, …)
       ├─ src/lib/db/hooks.ts   live Dexie queries (dexie-react-hooks useLiveQuery)
       ├─ src/stores/*          Zustand: prefs (persisted), selection, vault
       └─ src/lib/<domain>/     pure domain logic (srs, quiz, roadmap, concepts, notes, ingest, …)
            ├─ src/lib/db/*     Dexie repos, one per table group
            ├─ src/lib/ai/*     providers, runners, prompts, retrieval, pipelines
            └─ src/lib/tauri/*  bridges to Rust commands and plugin-http
src-tauri/src/*            Rust shell: plugins, keychain, TTS sidecar, sysinfo, agent CLI processes
```

Rules that keep this shape: domain logic stays pure and Vitest-tested; components do not talk to providers
directly but through `src/lib/ai` modules or runners; `src/lib/tauri` is the only place that calls `invoke`.

## 3. Routing

- Top level: `/` (landing), `/dashboard`, `/workspaces`, `/setup/[step]`, and settings: `/settings` (general) plus one
  static route per section (`/settings/providers`, `/settings/usage`, `/settings/models`, …). `src/app/settings/layout.tsx`
  renders the shell and left nav; sections, groups, search keywords and the redirect of old `/settings#tab` links live in
  `src/components/settings/layout/settings-nav.ts`.
- Workspace: `/w/[id]` plus `read/[sourceId]`, `chat`, `notes`, `cards`, `quiz`, `map`, `research`,
  `study/[lessonId]`, `study/journal`, `audio/[podcastId]`, `roadmap`, `roadmap/[roadmapId]`,
  `analysis`, `analysis/[analysisId]`. There is no `/w/[id]/study` index page.
- No auth: the app is single-user and local.

Static export cannot pre-render runtime workspace ids, so only `/w/_/...` shells exist and three mechanisms map
real ids onto them (dev rewrites, the Rust asset fallback, client-side param recovery). Adding a route under
`/w/[id]` has a checklist: [STATIC_EXPORT_WORKSPACE_ROUTING.md](STATIC_EXPORT_WORKSPACE_ROUTING.md).

## 4. State and persistence

- **Dexie** (`src/lib/db/schema.ts`): the single source of truth for user data. The version chain is append-only;
  each `this.version(n)` block stays. Repos in `src/lib/db/*.ts` own reads/writes; components subscribe through
  `src/lib/db/hooks.ts`. There is no TanStack Query and no server cache.
- **Prefs** (`src/stores/prefs.ts`): Zustand `persist` with `PREFS_VERSION` and a cumulative migration function.
  Holds UI settings, model bindings per task, provider/search/TTS choices, vault settings, `agentCli` paths.
  New fields are patched in place in their own version step; strict shape checks in old steps can reset
  `modelBindings` to defaults.
- **Selection** (`src/stores/selection.ts`): reader text selection in its own store so selecting text does not
  re-render the reader tree.
- **Blobs**: original PDF/DOCX/MD/TXT files in `src/lib/db/source-blobs.ts`, used for re-chunking.
- **Backup** (`src/lib/backup`): JSON export/import with `BACKUP_SCHEMA_VERSION`; binary blobs and the
  filesystem vault are excluded; import accepts every version from `OLDEST_SUPPORTED_BACKUP_VERSION` up.

## 5. Credentials (BYOK)

`src/lib/db/api-keys-repo.ts` picks a backend: `keychain` (Tauri, keyring-rs through `keychain_*` commands)
or `dexie` (web dev). Keys are resolved per call by `resolveChatCredentialForPreset` in
`src/lib/ai/anthropic-credential.ts`. `presetIsKeyless()` short-circuits for loopback endpoints and for presets
with `externalAuth: true` (local agent CLIs). Keys are never logged and never echoed back by the proxies.
Provider setup: [PROVIDERS.md](PROVIDERS.md), [PROVIDERS_LOCAL.md](PROVIDERS_LOCAL.md).

## 6. AI layer

### Providers

- Presets (`src/lib/ai/providers/presets.ts`) describe each provider: id, `ProviderFamily`
  (`anthropic`, `openai-compat`, `gemini`, `agent-cli`, …), base URL, auth style, model list.
  `registry.ts` maps a preset to an implementation: `getChatProvider(id)`, `getEmbedProvider(id)`.
- Every chat provider exposes `streamChat()` returning one normalized event stream (`src/lib/ai/providers/types.ts`):
  `start`, `text`, `tool_start` / `tool_input_delta` / `tool_stop`, `delta` (stop reason + usage), `stop`,
  `error` (with HTTP-like `status`), `abort`.
- Request bodies are built once in `src/lib/ai/upstream/*` (`buildChatUpstream`, embed/oauth/responses builders)
  and sent either through the dev proxy or directly with `tauriFetch`.
- Providers without native tools use the JSON tool protocol in `tool-translator.ts`
  (`buildJsonToolPrompt`, `parseJsonToolUseFromText`, `withJsonToolFallback`).
- Model lists are fetched live where the provider allows (`providers/model-fetch/`); the preset's list is the
  offline fallback. Codex lists models through `codex app-server`, OpenCode through the model option of a
  throwaway `opencode acp` session.
- Local agent CLIs (`claude-cli`, `codex-cli`, `opencode-cli`) are processes, not HTTP: see
  [PROVIDERS_LOCAL.md](PROVIDERS_LOCAL.md).
- Account and limit status for those CLIs comes from the CLIs themselves (`src/lib/ai/agent-status`: Claude
  `initialize` / `get_usage` control requests, Codex app-server `account/read` / `account/rateLimits/read`, OpenCode
  ACP `session/new` models), cached in the `useAgentStatus` store. No credential file is read.
- Settings → Providers is built from `buildProviderCatalog` (`src/lib/ai/provider-catalog.ts`): chat presets grouped
  as CLI / local / cloud / custom with a status per entry. `prefs.disabledProviders` hides a provider from model
  pickers via `filterEnabledChatOptions`, except where a saved binding still uses it.

### Usage scan

Settings → Usage reads the local Claude Code and Codex logs, not TME's own records. The Rust command `usage_scan`
(`src-tauri/src/usage.rs`) walks `<claude home>/projects/**/*.jsonl` and `<codex home>/sessions/**/*.jsonl[.zst]`
read-only, without following symlinks. It skips files older than the range and caches parsed events per file
(by mtime and size).

Claude usage is de-duplicated by `message.id:requestId`; Codex usage is taken as deltas of the cumulative counters,
with fork copies de-duplicated. The command returns only per-day, per-model token sums and session counts.

`src/lib/usage` turns the sums into totals, provider and model shares, a daily series and cost by type, using
`PRICING`. The cost is labelled an API estimate. Unpriced models count as zero and are listed.

### Prompts

- Builders live in `src/lib/ai/prompts/` (one file per feature). Both chat surfaces share the teaching and
  accuracy policy in `prompts/chat-guidance.ts` (also `CHAT_MAX_OUTPUT_TOKENS`, an upper bound, not a length target).
- `notebook-chat.ts` wraps selected chunks of one source in `<source>`; `workspace-chat.ts` wraps several
  sources in `<sources>` and appends the enabled context blocks. Instructions found inside sources and notes are
  treated as data.
- Large stable blocks carry `cache_control: { type: "ephemeral" }` so Anthropic-family providers cache them.
- A selected reader passage is sent as the user's question followed by a quoted block; the default question
  for an empty composer comes from `messages/*.json` (`reader.selected_passage_*`).

### Retrieval and context

- Embeddings are computed client-side through the chosen embed provider (`src/lib/ingest/embed.ts`) and stored
  with chunks; `topKChunks` in `src/lib/ai/retrieval.ts` ranks by cosine similarity.
- Without embeddings, `selectFallbackChunks` (`retrieval/fallback.ts`) ranks by lexical overlap with the question
  and selection, keeping source order when nothing matches.
- Workspace chat adds token-budgeted blocks from `src/lib/ai/context/` (notes, concepts, roadmap, performance,
  `budget.ts`), toggled by the context chips.
- `src/lib/ai/context-window.ts` derives the composer's context-fill chip from the last assistant message; it hides
  for unknown models. `pricing.ts` drives cost chips; models without a price entry show no price.

### Tools

Reader chat offers `add_flashcard` and `open_citation`; workspace chat offers `add_flashcard`
(`src/lib/ai/tools.ts`, handlers in `tool-handlers.ts`). `generate_flashcards` / `generate_quiz` are defined but
deliberately not exposed until real handlers exist: batch generation must keep going through the human-in-the-loop
`FlashcardProposalModal` (via `GenerateBatchModal`), while the chat tool `runAddFlashcard` writes a single card when the
user explicitly asks for one.

### Chat request lifecycle

`src/lib/ai/runners/chat-session.ts` owns each request outside React: `useChatSession(key)` returns a
`ChatSession` keyed by workspace/source. Leaving the page unsubscribes the view but does not abort; only Stop
aborts (the message is saved as interrupted). A new request in the same session waits for the previous one's
final writes, and the retry's delete step runs inside the same lock. `stream-writer.ts` serializes partial and
final writes so a late partial cannot overwrite the final text. A full reload or app restart does not resume a
generation.

### Multi-stage pipelines

Article analysis (`src/lib/ai/article-analysis.ts`) and cross-analysis (`src/lib/ai/cross-analysis.ts`) are
hand-rolled stage pipelines (no LangGraph/LangChain: no server runtime, bundle cost). Shared machinery is in
`src/lib/ai/stage-runner.ts`: typed stage errors, `runWithRetry` (retries 429/529/5xx/0 only),
`mapWithConcurrency`, `callStage`, `resolveModelBindings`.

- Article analysis: whole document (`listChunksBySource`, not RAG) → Map per section (`MAP_CONCURRENCY`) → Reduce →
  parallel critic / glossary / reflection → Synthesize. A failed stage downgrades the result to `draft` with a
  `fallbackReason`. `[S]` quotes are verified against chunk text by `src/lib/article-analysis/citation-verify.ts`;
  the verdict is assigned in code and never requested from the model.
- Cross-analysis compares stored analysis payloads: the matrix is built in code (`src/lib/cross-analysis/matrix.ts`),
  and the model may only return pairs of claim refs (`refs.ts`), so quoted text cannot be invented.
- Curriculum generation follows the same draft-first idea: a deterministic draft, then an optional AI refine.

## 7. Ingestion

`SourceUploader` / `AddUrlModal` → parse (`src/lib/ingest/pdf-worker.ts`, `docx-worker.ts`; URL/DOI/arXiv/YouTube
through `src/lib/research`) → `chunker.ts` → `chunks` table → embedding (optional, later). The chunker keeps
blank lines and, for Markdown input, indentation and hard breaks so CommonMark structure survives; PDF/DOCX text is
chunked as plain text. `rechunk.ts` rebuilds chunks from stored blobs, live notes or a re-fetch, and resets embeddings
for the re-embed flow; existing chunk references (citations) are not migrated.

## 8. Notes and the filesystem vault

Notes are CodeMirror 6 documents (`src/components/notes`, `src/lib/notes`) with wikilinks, backlinks, tags and daily
notes. A workspace can be mirrored to a folder of `.md` files: `src/lib/vault` handles the watcher, reconcile,
conflict policy, atomic writes and a cross-process lock. This "vault" is unrelated to the removed master-password
vault; `src/stores/vault.ts` is an always-unlocked stub kept for old call sites.

## 9. Desktop shell (Tauri 2)

- `src-tauri/src/usage.rs` holds the read-only `usage_scan` command (permission `allow-usage-scan`).
- `src-tauri/src/lib.rs` registers plugins (http, fs, dialog, notification, autostart, updater, process, opener,
  shell; log in debug builds), the system tray, the commands (`agent_cli_*`, `keychain_*`, `tts_*`, `sysinfo_*`, `usage_scan`) and
  the static-export asset fallback. Agent CLI sessions are shut down on webview reload and app exit.
- Tauri denies app commands by default: each command needs a `src-tauri/permissions/*.toml` entry and its identifier
  in `src-tauri/capabilities/default.json`. The same capability holds the plugin-http `allow` list of upstream hosts,
  which is maintained by hand.
- Headless mount components in `src/components/mounts/` wire desktop side effects once at the layout root
  (seed, update check, tray, menu, deep links, event bridge).
- TTS: Piper sidecar fetched by `scripts/fetch-piper.mjs` (runs on `postinstall` and before `tauri:*`).

## 10. Release and updates

- `.github/workflows/release.yml` runs on a `v*` tag push or a manual run with an existing `vX.Y.Z` tag, on
  `windows-latest`. It runs `node scripts/check-release.mjs <tag>` (npm and Tauri versions match, stable tag syntax,
  signed artifacts, configured endpoint), builds with tauri-action, and creates a **draft** release with `latest.json`.
- The updater (`plugins.updater` in `src-tauri/tauri.conf.json`) reads `latest.json` from the latest **published**
  GitHub release; a draft is invisible to it. Signing secrets: `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the public key is in `tauri.conf.json`.
- To ship: bump `package.json`, `package-lock.json` and the Tauri app version together, tag that commit, verify the
  draft's installers (`node scripts/check-release.mjs vX.Y.Z <releaseId>` with `gh` logged in), then publish.
- `UpdateCheckMount` checks in the background silently; a manual check in Settings surfaces errors.

## 11. i18n

`next-intl` with `messages/tr.json` and `messages/en.json`, provided by `src/i18n/IntlProvider.tsx` from the prefs
locale. Every UI string goes through it. AI output language is a separate preference (follow source, TR, EN).

## 12. Security and privacy

- No telemetry. Never log prompts, responses or keys.
- The web build sends a CSP whose `connect-src` is derived from the provider presets (`src/lib/ai/csp-origins.ts`,
  `buildHeaders` in `next.config.ts`); headers are not available in static export, and `tauri.conf.json` sets
  `"csp": null`, so the desktop app relies on the plugin-http allow list instead.
- Rendered Markdown and HTML go through DOMPurify (`src/lib/utils/sanitize.ts`).
- Agent CLI commands validate entry names, arguments and env overrides, refuse `.cmd`/`.bat`, reject working-directory
  overrides, and kill the whole process tree. The configured binary itself is trusted.

## 13. Testing and verification

- Vitest (`vitest.config.ts`): tests sit next to the module; jsdom for `src/components/**/*.test.tsx`,
  `src/lib/db/**/*.test.ts` and `*.dom.test.ts`, node elsewhere; `fake-indexeddb` for Dexie.
- Playwright (`playwright.config.ts`): `tests/e2e/*.e2e.ts`, Chromium, starts `npm run dev` itself. Provider calls
  are stubbed at the HTTP boundary with controlled SSE, so no live quota is used.
- Rust: `cargo test --manifest-path src-tauri/Cargo.toml --offline`; installed-CLI smoke tests are `#[ignore]` and
  opt-in (see [PROVIDERS_LOCAL.md](PROVIDERS_LOCAL.md)).
- There is no PR CI workflow; run `npm run typecheck`, `npm run lint` and `npm run test:run` (and the Rust tests for
  native changes) before merging. Do not pipe a gate command through `tail`: the pipeline reports tail's exit code.
