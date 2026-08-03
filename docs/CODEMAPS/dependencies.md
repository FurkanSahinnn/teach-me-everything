<!-- Generated: 2026-08-03 | Files scanned: 612 | Token estimate: ~850 -->

# Dependencies

All third-party services are **BYOK** — the user supplies every key. Nothing is bundled, nothing phones home ([no telemetry, ever](../../CLAUDE.md)).

## Runtime Stack

| Package | Version | Role |
|---|---|---|
| `next` | ^16.2.7 | App Router; static export for Tauri |
| `react` / `react-dom` | 19.2.4 | UI |
| `dexie` + `dexie-react-hooks` | ^4.4 | IndexedDB store + live queries |
| `zustand` | ^5.0.12 | prefs / selection / vault stores |
| `zod` | ^4.4.3 | schema validation (AI payloads, forms) |
| `next-intl` | ^4.9.1 | TR / EN i18n |
| `tailwindcss` | ^4 | `@theme` tokens, 3 themes |
| `lucide-react` | ^1.8.0 | icons |
| `clsx` + `tailwind-merge` | — | `cn()` utility |
| `cmdk` | ^1.1.1 | command palette |

## Content Processing

| Package | Role |
|---|---|
| `pdfjs-dist` ^5.6 | PDF parse (worker) + reader canvas/textLayer |
| `mammoth` ^1.8 | DOCX → HTML → chunks |
| `@mozilla/readability` ^0.5 | local URL extraction (no API key) |
| `turndown` ^7.2 | HTML → Markdown |
| `markdown-it` + `@vscode/markdown-it-katex` | document preview (VS Code engine parity) |
| `react-markdown` + `remark-gfm/math` + `rehype-katex/highlight` | chat + note preview |
| `katex`, `highlight.js` | math + code rendering |
| `isomorphic-dompurify` | sanitize untrusted HTML |
| `youtube-transcript` ^1.2 | YouTube ingestion |
| `html2pdf.js` | legacy raster export path (analysis/study exports use iframe print instead) |
| `@codemirror/*` + `@lezer/markdown` | notes editor + live-preview widgets |

## Desktop Shell — Tauri 2.11

`@tauri-apps/api` + plugins: `http` (direct provider calls, bypasses `/api`) · `fs` + watch (filesystem vault) · `dialog` · `notification` · `autostart` · `updater` · `process` · `opener`.
Rust crates: `keyring-rs` (OS keychain), `sysinfo` (RAM/VRAM probe), tray-icon.
Sidecar: **Piper** TTS binary, fetched by `scripts/fetch-piper.mjs` on `postinstall` / `tauri:dev` / `tauri:build`.

## External Services (all BYOK, all optional)

**Chat/LLM presets (16 cloud + 3 local)** — anthropic, claude-code-oauth, openai, google-gemini, openrouter, groq, deepseek, glm, xai, mistral, together, cerebras, perplexity · local: ollama, lm-studio, llama-cpp · plus `custom:${string}` endpoints.

**Embeddings** — openai, openai-compat, google-gemini, voyage, cohere, jina, huggingface.

**Web search (in-chat)** — claude, gemini, glm, mistral, openai-responses, openrouter, perplexity, xai.

**Source search** — brave, brave-unified, exa, tavily, chat-llm-search.

**URL extraction** — firecrawl, exa, tavily, jina-reader, diffbot, brightdata, readability (local, keyless).

**Keyless ingest** — arXiv API, DOI/Crossref, YouTube transcripts.

## TTS Runtimes

| Adapter | Status |
|---|---|
| `piper` | default, local sidecar |
| `web-speech` | browser fallback |
| `experimental-local` | Kokoro / XTTS / VibeVoice POC slot (Phase 12, not shipped) |

ElevenLabs was removed in Phase 11 (paid + cloud); Dexie v26 deletes its stored key.

## Dev / Test

`typescript` ^5 (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) · `vitest` ^2.1.9 + `@vitest/coverage-v8` + `fake-indexeddb` + `jsdom` · `@testing-library/{react,jest-dom,user-event}` · `@playwright/test` ^1.59 (17 E2E specs) · `eslint` ^9 + `eslint-config-next` · `cross-env`.

`@anthropic-ai/claude-agent-sdk` is present as a dependency but is **not** on the app's runtime provider path — chat goes through `lib/ai/providers/*`.

## Forbidden / Absent By Policy

- **PostgreSQL, Supabase, any server DB** — local-first only.
- **Cloud deploy targets** (Vercel / Netlify / CF Pages) — distribution is Tauri-only via GitHub Releases.
- **Telemetry / analytics SDKs** — none, at any tier.
- **Bundled API keys or mock/stub paths in production.**

## Release Blockers (user-side, unchanged)

1. `npx tauri signer generate` → replace PLACEHOLDER pubkey in `tauri.conf.json`
2. GH Secrets `TAURI_SIGNING_PRIVATE_KEY` + `_PASSWORD`
3. Updater endpoint repo URL
