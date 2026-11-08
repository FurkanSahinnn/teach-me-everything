# Dependencies codemap

Versions are the ranges in `package.json` and `src-tauri/Cargo.toml`; read those files for exact numbers. "Used in" comes from import greps over `src/`. Related: [architecture](architecture.md), [backend](backend.md), [PROVIDERS](../PROVIDERS.md).

## Runtime (npm)

| Purpose | Packages | Used in |
|---|---|---|
| Framework | `next`, `react`, `react-dom` | `src/app`, all components; `react-dom/server` in `lib/study/pdf-export.ts`, portals in `ui/Modal.tsx` |
| State, data | `zustand`, `dexie`, `dexie-react-hooks` | `src/stores`; `src/lib/db` (+ a few components using live queries) |
| Validation | `zod` | `lib/roadmap`, `lib/cross-analysis`, `lib/article-analysis`, `lib/ai` schemas |
| i18n | `next-intl` | `src/i18n`, nearly every component |
| UI helpers | `lucide-react`, `clsx`, `tailwind-merge`, `cmdk` | components; `lib/utils/cn.ts`; `components/palette` |
| Markdown render | `markdown-it`, `@vscode/markdown-it-katex`, `highlight.js`, `isomorphic-dompurify` | `lib/markdown`, `lib/utils/sanitize.ts` |
| Markdown in chat | `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex` | `components/notebook/ChatBubble.tsx`, `lib/study` |
| Math styling | `katex` | CSS import in `src/app/globals.css` only |
| Note editor | `@codemirror/{state,view,commands,language,autocomplete,search,lang-markdown}`, `@lezer/markdown` | `lib/notes` (extensions, live preview), `components/notes` |
| Ingest | `pdfjs-dist`, `mammoth`, `@mozilla/readability`, `turndown` | `lib/ingest`, `components/sources/PdfViewer.tsx`, `lib/research` |
| Export | `html2pdf.js` | `lib/study` (PDF export) |
| YouTube | `youtube-transcript` | `src/app/api/ai/research/youtube/route.ts` |
| Agent SDK | `@anthropic-ai/claude-agent-sdk` | `src/app/api/ai/chat-oauth/route.ts` only |
| Tauri JS | `@tauri-apps/api` | `lib/tauri`, `lib/podcast`, `lib/vault`, `components/mounts` |
| | `@tauri-apps/plugin-http` | `lib/tauri/fetch.ts` |
| | `@tauri-apps/plugin-fs`, `plugin-dialog` | `lib/vault` (fs-adapter, watcher), settings |
| | `@tauri-apps/plugin-updater`, `plugin-process`, `plugin-opener` | `components/settings` (UpdatesSection), `components/mounts` |
| | `@tauri-apps/plugin-autostart` | dynamic import in `components/settings/AutoLaunchSection.tsx` |

No import found in `src/`: `@tauri-apps/plugin-notification` (the Rust plugin is registered in `lib.rs` and permitted via `notification:default`) and `rehype-highlight`.

## Dev (npm)

TypeScript 5, ESLint 9 with `eslint-config-next` (`eslint.config.mjs`), Tailwind v4 via `tailwindcss` + `@tailwindcss/postcss`, Vitest 2 with `@vitest/coverage-v8`, `jsdom`, `fake-indexeddb`, Testing Library (`react`, `jest-dom`, `user-event`), `@playwright/test`, `@tauri-apps/cli`, `cross-env`, type packages (`@types/node`, `react`, `react-dom`, `markdown-it`, `turndown`).

## Rust crates (`src-tauri/Cargo.toml`)

| Group | Crates | Used in |
|---|---|---|
| Core | `tauri` (feature `tray-icon`), `tauri-build`, `serde`, `serde_json`, `log` | `lib.rs`, `build.rs` |
| Tauri plugins | `tauri-plugin-{http, fs (watch), dialog, notification, autostart, updater, process, opener, shell, log}` | `lib.rs` registration; `shell` also in `tts.rs` |
| Credentials | `keyring` (apple-native, windows-native, sync-secret-service) | `keychain.rs` |
| Agent CLI | `shared_child`, `tempfile`; `windows-sys` (Windows job objects), `libc` (Unix) | `agent_cli.rs`, `agent_process.rs` |
| TTS download | `reqwest` (rustls, stream), `tokio` (fs, io-util), `futures-util` | `tts.rs` |
| System probe | `sysinfo` (system, disk) | `sysinfo.rs` |

Piper TTS binaries are bundled as Tauri resources (`tauri.conf.json` `bundle.resources`, `src-tauri/binaries/`), fetched by `scripts/fetch-piper.mjs`.

## External services

All calls are user-initiated with the user's own keys (BYOK), except free metadata endpoints. Hosts come from the files below; egress control is described in [architecture](architecture.md).

- **Chat** (`src/lib/ai/providers/presets.ts`, `PROVIDER_PRESETS`): Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, DeepSeek, GLM (open.bigmodel.cn), xAI, Mistral, Together, Cerebras, Perplexity; loopback Ollama, LM Studio, llama.cpp; no host for `claude-cli` / `codex-cli` / `opencode-cli` (local binaries). User-defined endpoints via `customEndpoints` in prefs.
- **Embeddings** (`src/lib/ai/providers/embed-presets.ts`, `EMBED_PRESETS`): OpenAI, OpenRouter, Voyage, Gemini, Cohere, Jina, Mistral, Hugging Face router, local Ollama.
- **Research extractors** (`src/lib/research/providers/presets.ts`): readability (local), Firecrawl, Exa, Jina Reader, Tavily, Diffbot, Bright Data. Search: Brave, Exa, Tavily (`src/lib/research/search/`).
- **Seed origins** (`src/lib/ai/csp-origins.ts`, `SEED_ORIGINS`): `'self'`, api.anthropic.com, huggingface.co (Piper voice download), api.crossref.org and api.openalex.org (DOI), export.arxiv.org, api.search.brave.com.
- **Tauri HTTP allow list** (`src-tauri/capabilities/default.json`, `http:default`): hand-maintained. It includes hosts without a current preset (fireworks.ai, api.z.ai, `*.openai.azure.com`, www.googleapis.com, youtube.googleapis.com) and lacks `api.cerebras.ai`, which `PROVIDER_PRESETS` defines; the CSP list is derived automatically, this one is not.
