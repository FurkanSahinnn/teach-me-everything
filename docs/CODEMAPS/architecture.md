# Architecture codemap

Where things live at the top level and how a request travels. Details per area: [backend](backend.md), [frontend](frontend.md), [data](data.md), [dependencies](dependencies.md). Prose overview: [ARCHITECTURE](../ARCHITECTURE.md); feature list: [FEATURES](../FEATURES.md).

## Top-level layout

| Path | Responsibility |
|---|---|
| `src/app/` | Next.js App Router: pages, layouts, `api/ai/*` route handlers, `globals.css` (Tailwind v4 tokens) |
| `src/components/<domain>/` | UI grouped by domain; `mounts/` holds headless mount-once components |
| `src/lib/` | All non-UI logic: `ai/`, `db/`, `ingest/`, `research/`, `podcast/`, `vault/`, `backup/`, `tauri/`, `notes/`, `markdown/`, `srs/`, `quiz/`, `study/`, `roadmap/`, `concepts/`, `article-analysis/`, `cross-analysis/`, `storage/`, `crypto/`, `reader/`, `dashboard/`, `utils/` |
| `src/stores/` | Zustand stores: `prefs.ts`, `selection.ts`, `vault.ts` (stub) |
| `src/hooks/` | Cross-feature hooks (`useApiKeyManager`, `useProviderChatModels`, `useSystemCheck`, `useHydrated`, `useCurrentTime`) |
| `src/i18n/` + `messages/{tr,en}.json` | next-intl provider and message catalogs (`messages/` is at the repo root) |
| `src/types/` | Ambient `.d.ts` shims (`mammoth-browser`, `pdfjs-worker`) |
| `src-tauri/` | Rust shell: `src/` (commands, static-export fallback), `capabilities/`, `permissions/`, `tauri.conf.json`, `binaries/` (Piper TTS resources) |
| `tests/e2e/` | Playwright specs (`*.e2e.ts`) with `fixtures/` and `helpers/`; unit tests sit beside sources as `*.test.ts(x)` |
| `scripts/` | `fetch-piper.mjs` (postinstall / tauri scripts), `check-release.mjs`, routing repro scripts |
| `.github/workflows/release.yml` | Only workflow in the repo (tag or manual release) |

Config at root: `next.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.mjs`.

## Runtime modes

| | Web dev server (`npm run dev`) | Tauri desktop (`npm run tauri:dev` / `tauri:build`) |
|---|---|---|
| Build | `next dev` / `next build` | `npm run build:export` (`NEXT_OUTPUT_EXPORT=true`, `output: "export"`, `pageExtensions` excludes route handlers) into `out/` (`tauri.conf.json` `frontendDist`) |
| `src/app/api/ai/*` | Active; LLM/embed/research proxies | Not built; the client calls upstreams directly |
| HTTP from client | via `/api/ai/*` | `tauriFetch` (`src/lib/tauri/fetch.ts`, plugin-http) gated by `isTauriEnvWithOverride()` (`src/lib/tauri/env.ts`) |
| API keys | Dexie `apiKeys` (plaintext, dev only) | OS keychain via `keychain_*` commands |
| Dynamic `/w/<id>/...` | `workspaceDevRewrites()` in `next.config.ts` rewrites onto `/w/_/...` | `serve_export_asset` / `export_shell_fallback` in `src-tauri/src/lib.rs` serve the `/w/_/...` shell |
| CSP / egress | `headers()` in `next.config.ts`, built from `deriveConnectOrigins()` (`src/lib/ai/csp-origins.ts`) | `tauri.conf.json` sets `csp: null`; outbound hosts are limited by the `http:default` allow list in `capabilities/default.json` |

Static export pre-renders only `/w/_/...`; pages read the real id from the URL with `useRouteParams` (`src/lib/utils/route-params.ts`). See [STATIC_EXPORT_WORKSPACE_ROUTING](../STATIC_EXPORT_WORKSPACE_ROUTING.md).

## Main paths (file level)

- **Boot:** `src/app/layout.tsx` wraps children in `IntlProvider` and `ToastProvider`, then mounts `VaultSetupBoot`, `TrayMount`, `DeepLinkMount`, `MenuMount`, `EventBridgeMount`, `UpdateCheckMount`. `AppShell` mounts `SeedBootstrap`. `src/app/w/[id]/layout.tsx` mounts `WorkspaceVaultMount`.
- **Chat:** page -> `useChatSession` / `ChatSession` (`src/lib/ai/runners/chat-session.ts`) -> `getChatProvider(id).streamChat()` (`src/lib/ai/providers/registry.ts`) -> stream events -> `createStreamWriter` (`runners/stream-writer.ts`) -> `chatMessages` in Dexie. Context blocks come from `src/lib/ai/context/` (`gatherContextBlocks`), RAG from `src/lib/ai/retrieval.ts` (`topKChunks`).
- **Generation features** (quiz, flashcards, roadmap, curriculum, podcast script, concepts): `src/lib/ai/<feature>-gen|generation.ts` + `prompts/` + `stage-runner.ts`; results stored through `src/lib/db/*` repos.
- **Article analysis:** `src/lib/ai/article-analysis.ts` driven by `runners/article-analysis-runner.ts`; helpers in `src/lib/article-analysis/`.
- **Ingest:** `SourceUploader` / `AddUrlModal` -> `src/lib/ingest/` (pdf/docx workers, `chunker.ts`) or `src/lib/research/` (URL, arXiv, DOI, YouTube) -> `sources` + `chunks` -> `ingest/embed.ts` -> `topKChunks`.
- **Local agent CLI:** `providers/claude-cli.ts` / `codex-cli.ts` / `codex-app-server.ts` / `opencode-cli.ts` / `opencode-acp.ts` -> `src/lib/tauri/agent-cli.ts` -> Rust `agent_cli_*` commands (`src-tauri/src/agent_cli.rs`) streaming over a Tauri `Channel`.
- **Podcast audio:** `src/lib/podcast/synthesize.ts` -> adapters (`piper`, `web-speech`, `experimental-local`) -> Rust `tts_*` commands for Piper; blobs in `podcastBlobs`.
- **Vault sync:** `WorkspaceVaultMount` -> `VaultReconcilerProvider` -> `src/lib/vault/` (watcher, reconcile, serialize) <-> `notes` / `noteFolders`.
- **Backup:** `src/lib/backup/export.ts` / `import.ts` over Dexie tables (see [data](data.md)).
- **Release:** `release.yml` -> `scripts/check-release.mjs` -> tauri-action build with updater metadata.
