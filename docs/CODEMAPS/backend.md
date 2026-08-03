<!-- Generated: 2026-08-03 | Files scanned: 612 | Token estimate: ~900 -->

# Backend

There is no application server. "Backend" = (a) Next route handlers that proxy LLM/search calls on **web dev builds only**, and (b) the **Rust Tauri** command surface. In Tauri builds every route handler is bypassed — the client calls upstream directly via `plugin-http`.

## Route Handlers — `src/app/api/ai/`

| Route | Runtime | Flow |
|---|---|---|
| `POST /api/ai/chat` | edge | `route.ts` → `upstream/chat-request` → provider base URL (SSE passthrough) |
| `POST /api/ai/chat-responses` | edge | OpenAI Responses API shape → `upstream/responses-request` |
| `POST /api/ai/chat-oauth` | nodejs | Claude Code OAuth token flow → `upstream/oauth-request` |
| `POST /api/ai/embed` | edge | `upstream/embed-request` → `embed-fetch` → embed provider |
| `POST /api/ai/test` | nodejs | `upstream/test-key` — BYOK key validation ping |
| `GET /api/ai/research` | nodejs | URL extract dispatch → `research/providers/*` |
| `GET /api/ai/research/youtube` | nodejs | `research/youtube-fetch` (transcript) |

All are `dynamic = "force-dynamic"`. Keys arrive per-request from the client and are never persisted server-side.

## Provider Layer — `src/lib/ai/providers/`

```
registry.ts  getChatProvider(id) / getEmbedProvider(id) / listChatProviderIds()
  ├── anthropic.ts · anthropic-oauth.ts · gemini.ts (+gemini-retry)
  ├── openai-compat.ts · openai-responses.ts · local-bypass.ts
  ├── presets.ts          16 cloud + 3 local preset descriptors
  ├── tool-translator.ts  Anthropic tool schema ↔ OpenAI function schema
  ├── embed-*.ts          openai, openai-compat, gemini, cohere, voyage, jina, hf
  ├── model-fetch/        per-provider GET /models → ModelDescriptor[] (16 adapters
  │                       + adapter.ts, tier-infer.ts) — cached in Dexie
  └── web-search/         claude, gemini, glm, mistral, openai-responses,
                          openrouter, perplexity, xai
```

Chat entry point everywhere: `getChatProvider(preset).streamChat()` → consumed by `drainStream` + `estimateCost` ([ai/pricing.ts](src/lib/ai/pricing.ts)).

## AI Orchestration — `src/lib/ai/`

| Generator | Entry | Prompt |
|---|---|---|
| Article analysis (multi-stage) | `article-analysis.ts` | `prompts/article-analysis.ts` |
| Workspace chat | `runners/workspace-chat-runner.ts` | `prompts/workspace-chat.ts` |
| Curriculum (draft-first) | `curriculum-generation.ts` | `prompts/curriculum.ts` |
| Roadmap DAG | `roadmap-gen.ts` | `prompts/roadmap-gen.ts` |
| Flashcards / Quiz / Quiz-eval | `flashcard-gen.ts`, `quiz-gen.ts`, `quiz-eval.ts` | `prompts/*` |
| Concepts | `concept-extraction.ts` | `prompts/concept-extract.ts` |
| Podcast script | `podcast-generation.ts` | `prompts/podcast-script.ts` |
| Lesson note / journal | `lesson-note-generation.ts`, `study-journal-generation.ts` | `prompts/*` |

**Article Analysis pipeline** (hand-rolled multi-agent, no LangGraph):
```
listChunksBySource (whole doc, NOT topKChunks)
  → Map: per-section summary+quote (parallel)
  → Reduce: understanding layer
  → fan-out: critic ‖ glossary ‖ reflection (Promise.allSettled)
  → Synthesize: orientation
malformed stage → status:'draft' + fallbackReason (never hard-fails)
```

**Retrieval**: [ai/retrieval.ts](src/lib/ai/retrieval.ts) — `topKChunks()` over `cosineSim`/`dotProduct`/`l2Norm` on in-memory Float32Array embeddings. Dim-guarded via `chunks.embeddingDim`.

**Context injection** (workspace chat chips): `ai/context/{notes,concepts,roadmap,performance,budget}` → token-budgeted prompt blocks.

## Rust Commands — `src-tauri/src/` (1706 LOC)

| Module | Commands |
|---|---|
| `keychain.rs` | `keychain_get` · `keychain_set` · `keychain_delete` · `keychain_list` |
| `sysinfo.rs` | `sysinfo_probe` · `sysinfo_gpu` (VRAM probe for TTS gating) |
| `tts.rs` | `tts_piper_check_readiness` · `tts_piper_synthesize` · `tts_list_installed_voices` · `tts_install_voice` · `tts_delete_voice` |
| `lib.rs` (565) | app setup, tray, menu, deep-link, `export_shell_fallback` static-route resolver (`DYN_PARENTS`) |

## Research / Search — `src/lib/research/`

- Extract providers: `firecrawl` · `exa` · `tavily` · `jina-reader` · `readability` · `diffbot` · `brightdata` → `providers/registry.ts`
- Search dispatch: `search/dispatch.ts` → `brave`, `brave-unified`, `exa`, `tavily`, `chat-llm-search`
- Ingest classifiers: `url-classifier` · `doi-fetch` · `arxiv-fetch` · `youtube-fetch` → `ingest.ts`
