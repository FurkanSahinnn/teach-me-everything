# CLAUDE.md — Teach Me Everything

> Guide for Claude Code (and other AI agents) working on this repo. Auto-loaded into context every session.

---

## Project Summary

**Teach Me Everything (TME)** — open-source (MIT) workspace beyond NotebookLM, focused on **active learning**. Users upload PDFs / articles / notes, chat with Claude, auto-generate **flashcards / quizzes / mind maps / podcasts**, and learn via **SM-2 spaced repetition**.

**Core principles:**
- 🏠 **Local-first** — all data stays on the user's machine (IndexedDB / SQLite). **No PostgreSQL.**
- 🔑 **BYOK** — user provides their own Anthropic, OpenAI-compatible, Gemini, research-provider, and local runtime keys/config
- 🔓 **MIT license** — forkable, self-hostable
- 🇹🇷 TR / EN bilingual; Turkish is a first-class source language
- ☁️ **No cloud deploy** — distribution Tauri-only via GitHub Releases (`feedback_no_cloud_deploy.md`)

---

## Status — v1.0.0-rc13 phase13-roadmap · 2026-05-25

**Current next phase:** Phase 11 manual smoke/release gate, then **Phase 12 — Heavy Local TTS Runtime POCs** (`Kokoro`, `XTTS`, `VibeVoice`). Phase 13 (Roadmap) + Workspace Chat + Article Analysis (below) shipped.

**Markdown fidelity — chunker structure preservation ✅ 2026-09-06** — "Obsidian'da kusursuz görünen markdown bizde berbat" had ONE root cause and it was not the renderer: `chunkPages` dropped every blank line and trimmed every line (`if (!trimmed) continue`), so every chunk in Dexie had lost the grammar CommonMark reads structure from. Measured with a fixture pushed through chunker → `splitChunkIntoMarkdownSegments` → markdown-it and diffed against a direct render: paragraph + `---` became a setext H2 (the screenshot's giant bold "paragraph"), consecutive paragraphs merged, the paragraph after a list was absorbed into its last `<li>`, everything after a blockquote fell inside it, nested lists flattened, and ordered lists were split into one `<ol start=N>` per item because the outline's numbered-heading heuristic fired on list items; `section` also carried the *last* heading seen, not the first line's. Fixes: (1) chunker keeps blank lines (runs collapsed to one) and, in `format: "markdown"` (explicit from md/URL/note callers, else auto-detected from `#`), leading indentation and trailing double-space breaks; splits prefer a blank line (`MAX_TOKENS`) with a `HARD_MAX_TOKENS` fallback; overlap tail starts at a paragraph boundary and never inside a fence; `section` = section in force at the chunk's first content line; heading heuristics stay for `plain` (PDF/DOCX) text only. (2) `outline.ts`: numbered-heading heuristic off in `#` documents, and in plain text a numbered line flanked by other numbered lines or reading as a sentence is not a heading (bold/colon labels kept — LLM lessons rely on them). (3) New `lib/markdown/obsidian-plugins.ts` (custom, no deps, all output escaped): task lists, `> [!TYPE] title` callouts, `[[wikilink|alias]]` / `![[embed]]`, footnotes (`[^1]:` must be a **block** rule ahead of `reference` or CommonMark swallows it as a link-reference definition), `==mark==`; CSS in `globals.css`. (4) Existing data cannot be repaired from `chunks.text` — structure is gone — so new `lib/ingest/rechunk.ts` + Settings → **"Kaynak yapısı" `RechunkSection`** rebuild chunks from what the app still holds: the stored blob (pdf/docx/md/txt), the live note, or a re-fetch by URL (`fetchResearchContent` extracted from `research/ingest`); embeddings are reset to `missing` for the Reembed flow. `SourceUploader` now stores the blob for txt/md too (it only did pdf/docx), so pre-existing txt/md sources are reported as "needs re-upload". Ingest-path render is now byte-identical (whitespace-normalised) to a direct render of the same document. **Vitest 2029 / 205 files** ✅ + typecheck ✅. Segments are still rendered per heading (separate `markdown-preview` roots → slightly uneven vertical rhythm); a single-render-with-anchors pass is the follow-up.

**Local Agent CLI provider — Phase 2 ✅ 2026-09-06 (Codex CLI, the actual prize)** — New chat provider `codex-cli` ("Codex (local CLI)") on the same Rust transport, so a **ChatGPT Plus/Pro subscriber** — a plan with **no API equivalent at all** — runs TME with nothing stored. **Measured against codex-cli 0.153.4** (`scratchpad/codex-events*.jsonl`, live `scratchpad/codex-live.cjs` run: 8.7 s, correct answer from a flattened multi-turn prompt): `codex exec --json` emits JSONL with **no token deltas** — the whole reply lands in one `item.completed{agent_message}`, usage in `turn.completed`, failure as `turn.failed` whose `error.message` is itself a stringified upstream error (status unwrapped so 429/5xx stay retryable); `item.completed{error}` lines are **warnings** (malformed `~/.codex/agents/*.toml`, missing model metadata) and must not fail the turn. **No system-prompt channel** — instructions lead the stdin document (`-` reads the prompt to EOF, which also sidesteps the Windows argv cap). Usage mapping: Codex counts cached tokens *inside* `input_tokens`, Anthropic beside them; split so the cost chip doesn't double-bill. **Model discovery is live, not guessed:** `codex app-server` (JSON-RPC over stdio, `initialize → initialized → model/list`) answers with what the *account* may use — a ChatGPT login rejects `gpt-5` with a 400 — wired as `model-fetch/codex-cli` on the existing adapter registry, reusing `startAgentCli` (first non-HTTP fetch adapter); the preset's `availableModels` is only the offline snapshot (`gpt-6-astra` default · 5.6-sol/terra/luna · 5.5 · 5.4-mini). **The transport bug this exposed:** `plugin-shell`'s `CommandChild` owns the stdin pipe and cannot close it without dropping the handle you also need for `kill` — and `codex exec -` waits for EOF forever. Sessions now spawn via `std::process` + **`shared_child`** (`take_stdin/stdout/stderr`, `CREATE_NO_WINDOW` re-applied by hand) with a new `closeStdin` option; the Claude path is unchanged (holds stdin open by design). The probe still uses the plugin. Rust candidate paths are now per-CLI (`codex.exe` under `@openai/codex-win32-x64/vendor/.../bin` first — the `bin/codex.js` wrapper spawns it as a grandchild a kill would orphan). `AgentCliSection` generalised to one row per CLI (`agentCli.codexPath`, no prefs bump — optional field). New `providers/codex-cli` (+ test, 21 cases incl. abort-while-thinking and app-server handshake). Presets 16 → 17. **Remaining:** no token streaming for Codex (app-server's `item/agentMessage/delta` would give it — a JSON-RPC session transport is the follow-up); every Codex turn carries ~12k tokens of Codex's own cached system prompt that TME cannot strip; manual Tauri smoke of the rewritten Rust spawn path still to do.

**Local Agent CLI provider — Phase 1 ✅ 2026-08-31 (transport + Claude CLI)** — New chat provider `claude-cli` ("Claude Code (local CLI)") that **spawns the user's installed `claude` binary** instead of calling an HTTP endpoint, so a Claude Pro/Max subscriber runs the whole app with **no API key stored anywhere**. Prompted by the Obsidian plugin [Claudian](https://github.com/yishentu/claudian); its own approach (`@anthropic-ai/claude-agent-sdk`) does **not** port — Obsidian is Electron, our Tauri build is a static export with no Node — so the transport is reimplemented in Rust against the CLI's raw `stream-json` protocol. **Note this overlaps the existing `claude-code-oauth` preset** (paste a `claude setup-token` value); the CLI path's remaining wins are no paste, no token expiry, and the seam for **Codex/ChatGPT subscriptions, which have no API equivalent at all** — that is Phase 2 and the actual prize. **The wire format is the gift:** each `stream_event` line wraps a verbatim Anthropic Messages SSE payload, so `consumeAnthropicStream` was split into `sseToPayloads` + new exported **`consumeAnthropicPayloads`** and the CLI reuses the mapper unchanged. **Measured, not assumed** (real runs, `scratchpad/verified-cli-facts.md`): naming all 27 tools in `--disallowedTools` (plus `--safe-mode --restricted --strict-mcp-config --disable-slash-commands --setting-sources ""`) takes the CLI from 12,522 → 8,864 → **0** cache-creation tokens and `tools: []` — a pure inference transport with none of the user's CLAUDE.md / skills / plugins / MCP leaking in. `--system-prompt-file` **exists but is undocumented in `--help`**; it is required, because Windows caps a command line near 32k chars and an article window is far longer. Rust stages it to a temp file and deletes it on exit. **First streaming Rust→JS path in the app** (`tauri::ipc::Channel`; everything else uses global `app.emit`). New `src-tauri/src/agent_cli.rs` (probe/start/write/stop; `plugin-shell`'s line-mode stdout gives NDJSON framing free; stderr always drained or the child deadlocks on a full pipe) — **no `shell:allow-execute` added**: a dedicated Rust command grants "run *the configured agent*", not a webview RCE primitive. Windows landmines reproduced and handled: `.cmd`/`.bat` refused outright (Rust, like Node post-CVE-2024-27980, fails EINVAL), `.cjs` wrappers detected by extension **plus** shebang sniff and run under `node`. New `ProviderFamily` member **`"agent-cli"`** — critical, because `family === "anthropic"` in `chat-request.ts` / `api/ai/chat/route.ts` means "build an HTTP request" and would have been wrong; `presets.test.ts` caught exactly this. **The one blocker unlocked:** `resolveChatCredentialForPreset` returned `null` with no key on file, killing all 14 JSON pipelines before any spawn; it now short-circuits on the new `ProviderPreset.externalAuth` flag. Prefs **v25** (`agentCli: {claudePath?, env?}`, patch-in-place — deliberately does not touch `modelBindings`, whose reset trap has bitten this repo three times). Model ids are the CLI's own aliases (`opus`/`sonnet`/`haiku`) and are **intentionally absent from `PRICING`** so the price chip hides rather than printing a figure a subscriber never pays — note `formatModelPriceLabel` still renders a bare `"Free"` for any 0/0 model, a pre-existing i18n+honesty bug left untouched. New `lib/tauri/agent-cli` + `lib/ai/providers/claude-cli` (+ colocated test) + `components/settings/AgentCliSection`; `withJsonToolFallback` extracted into `tool-translator` rather than copied. **Vitest 1967 / 200 files** ✅ + typecheck ✅ + `cargo check`/`test` ✅ + touched-file ESLint at baseline (`set-state-in-effect`, which sibling settings sections also hit). **Verified live** against `claude` 2.1.251: the exact argv the provider builds yields `tools: []`, `cache_creation: 0`, and a clean start/text/stop/result transcript. **Remaining:** the CLI is a *one process per request* mapping (TME's `ChatRequest` is stateless, so multi-turn history is transcribed into a single turn — a persistent session would double-send it); no vision passthrough; Codex (`codex exec --json --output-schema`, and `codex app-server` JSON-RPC for model discovery) not started. **Follow-up fix (same day):** selecting the provider still hit "No API key for Claude Code (local CLI)" — `resolveChatCredentialForPreset` was only one of several gates, and every chat entry point had its own `isLocalUrl(preset.baseUrl)` short-circuit, which a process-based provider (empty `baseUrl`) fails. Replaced by one shared `presetIsKeyless(presetId, baseUrl)` in `anthropic-credential.ts` (+ colocated test), applied at all six credential gates: reader chat, workspace chat, quiz x2, roadmap NodeInspector x2. **Context meter:** new pure `lib/ai/context-window.ts` (`resolveContextWindow` / `contextFillPercent` / `deriveContextFill`, + test) drives a percentage chip in both chat composer footers — the app had no context-window data at all before this, and cached tokens are counted because the context limit does not discount them the way billing does. Derived from the last assistant message (which already carries `model` plus all three token buckets) rather than new state, so it cannot drift. Unknown model means the chip hides itself, never a guessed number. **Vitest 1986 / 202 files** ✅. **The bug that actually blocked it:** `agent_cli_start not allowed. Command not found` — **Tauri 2.x denies every app command by default**, and this repo grants its own Rust commands one by one (`allow-keychain`, `allow-sysinfo-probe`, `allow-tts-*` in `capabilities/default.json`, backed by `permissions/*.toml`). A new `#[tauri::command]` is invisible to the webview until it has both. Added `permissions/agent-cli.toml` (`allow-agent-cli-probe` split from `allow-agent-cli-session`, so detection can be granted without execution) + the two identifiers in the capability. Nothing reaches Rust when this is missing, so a Rust-side `log::warn!` stays silent — the rejection is only visible as the raw `invoke` payload, which is why the bridge now `console.error`s it. **Two related mistakes worth not repeating:** `invoke` rejects with a bare **string** for `Result<_, String>` commands, so `err instanceof Error` silently discards the reason; and `cargo test ... | tail -N` reports **tail's** exit code, which hid a compile error in the Rust test module (missing `#[derive(Debug)]` on `Launch`) behind a green tick — never pipe a gate command whose exit code you intend to trust.

**Article Analysis — Map fan-out hardening ✅ 2026-08-12** — A real run on a 2506.05176v3 (Qwen3-Embedding) PDF came back `draft` with `map (1/11 sections)` and no cause. Three defects, all in Stage 1. (1) **The message meant the opposite of how it reads** — the numerator was `mapFailures`, so `1/11` was "1 failed", not "1 done"; now `map (1 of 11 sections failed: <cause>)`. (2) **Map was the only stage that dropped its failure reason** — every other stage appends `stageFailureDetail(err)`; Map now does too, with distinct causes de-duped and capped (`MAX_REPORTED_MAP_REASONS`) so 11 copies of one 429 don't bury the signal. (3) **Unbounded fan-out** — all N section calls left at once via `Promise.allSettled`, which is precisely what trips a provider's per-minute request/token limit; a single shed call then downgraded the whole run. Now `MAP_CONCURRENCY = 3` via new `mapWithConcurrency` (allSettled's contract — never rejects, input-order results — with a bounded worker pool) + one retry on transient statuses via `runWithRetry` / `isRetryableStreamError` (429 · 529 · other 5xx · 0; **not** parse failures — same prompt, same answer). `drainStream` now throws typed `ProviderStreamError` carrying `status` (message string byte-identical, since it is persisted in `fallbackReason`). Retry is abort-safe without knowing any pipeline's error type: the backoff resolves early on abort and re-enters the task, whose own guard throws the fatal error. Map progress now counts **settled** sections, not the group index, so the UI's `n/total` advances monotonically instead of jumping with completion order. New shared helpers live in `lib/ai/stage-runner` (+ colocated `stage-runner.test.ts`, its first). **Vitest 1945 / 199 files** ✅ + typecheck ✅ + touched-file ESLint ✅. Impact note: Map output is intermediate prompt context only — losing a section summary costs a summary, not the section's text, which still reaches later stages via `buildArticleWindow`.

**Cross-Analysis — backend ⏳ 2026-08-10 (UI not wired)** — Compare 2-4 **already-analyzed** papers and surface where they genuinely disagree. Runs over persisted `ArticleAnalysisPayload` rows, **NOT the PDFs again** — each payload is an already-distilled ~2k-token summary, so a four-paper comparison is one mid-size call instead of four full Map/Reduce pipelines. `AtAGlance` was shaped as a normalized machine-comparable header card for exactly this (see its `types.ts` comment). **Two outputs, one run:** (1) **matrix** — built in CODE from `AtAGlance` (`lib/cross-analysis/matrix.ts`), zero tokens, cannot fail, so a run whose every AI stage degrades still returns a usable comparison as `draft`; (2) **contradictions** — model-found, code-verified. **The anti-fabrication mechanism** (`lib/cross-analysis/refs.ts`): the model never writes claim text. Every claim gets a stable ref (`p0.kr2` = paper 0, keyResults 2) rendered into the prompt and may only return PAIRS OF REFS; text + citations are copied from the ORIGINAL claim. Unresolvable ref → dropped (model invented it); same-paper pair → dropped; `grounded: true` requires BOTH sides to carry a citation that already verified exact/fuzzy via `citation-verify`. Worst case is a wrong *pairing* of two real claims, which the reader can judge from the two verbatim quotes — the quotes themselves cannot be fabricated. Contradiction sides address papers positionally (`paperIndex` + ref), never by db id, so backup restore needs no remap on them. Reuses the **existing** `analysisCritique` / `analysisSynthesize` prefs bindings (no 4th binding, no prefs migration). New `lib/cross-analysis/{types,refs,matrix,schema}` + `lib/ai/{cross-analysis,prompts/cross-analysis}` + `lib/ai/stage-runner` (shared resolve/stream/parse machinery, extracted; `article-analysis.ts` still carries its own copy — deduping it there is a mechanical follow-up) + `lib/db/cross-analyses`. New table `crossAnalyses` (Dexie **v30**, multiEntry `*analysisIds`); **BackupV11**. Also fixed a latent backup defect: `ensureSchemaVersion` enumerated `[2..9, BACKUP_SCHEMA_VERSION]`, so bumping the constant past 10 made **every existing v10 backup unimportable** — now a derived contiguous range, covered by a legacy-v10 restore test. **Vitest 1916 / 198 files** ✅ + typecheck ✅ + touched-file ESLint ✅. **Remaining:** UI (compare tab + multi-select on the analysis list + generate modal + result view) and the runner hook — decided to sit on the existing `/w/[id]/analysis` page as a tab + modal, NOT a new dynamic route (avoids the `[analysisId]` collision and the static-export rewrite trap).

**Article Analysis — trust pass ✅ 2026-08-03** — Post-ship hardening of the grounding story (spec §13). (1) **Quote verification**: new pure `lib/article-analysis/citation-verify.ts` checks every `[S]` quote against real chunk text and persists a verdict `exact`/`fuzzy`/`unverified` on `AnalysisCitation.verification` — previously an invented "verbatim" quote rendered identically to a real one. Normalizes PDF punctuation (curly quotes / ligatures / line-break hyphenation), indexes chunks ONCE per run (was O(quotes × chunks)). `scoreGrounding()` drives a new "N/M claims source-verified" header on the detail page. Verdict is code-assigned, **never in a wire schema**. (2) **Windowing**: `ARTICLE_WINDOW_TOKENS` 12k → 32k and `clampToBudget` (head truncation) → new `buildArticleWindow` (chunk-aligned **head 60% + tail 40%**, middle elided + marked) — the old head-only clamp meant a long paper's Results/Discussion/Limitations never reached Reduce/Critique/Glossary/Synthesize verbatim while Reduce was still asked to cite from it. (3) **Deep-link**: `onJump` discarded its `chunkId`; now pushes `?chunk=<id>` and the reader scrolls+pulses the passage (hook sits **above** the reader's early returns — rules-of-hooks). `CitationChip` gains `approx`/`unverified` tones; uncited source-claims get a badge; PDF export carries verdicts. **Vitest 1889 / 196 files** ✅ + typecheck ✅ + touched-file ESLint at baseline.

**Article Analysis ✅ 2026-06-30** — New workspace-level feature at `/w/[id]/analysis` (list) + `/w/[id]/analysis/[analysisId]` (detail), sidebar "Analiz" (icon `FileSearch`): a **PhD-level, multi-stage AI analysis of a single PDF source** so a non-native reader understands a hard paper fast. **Hand-rolled multi-agent pipeline** (NOT LangGraph/LangChain — rejected for browser/Tauri/no-server incompatibility + bundle bloat; see spec §3): Stage 0 `listChunksBySource` (whole doc, NOT `topKChunks` RAG) → **Map** per-section summary+quote extraction (parallel) → **Reduce** understanding layer → **specialist fan-out** (reviewer-persona critic / bilingual glossary / reflection, parallel `Promise.allSettled`) → **Synthesize** orientation; payload assembled in code, malformed-stage → `status:'draft'` + `fallbackReason` (Phase 4.5.H draft-first). Output is 3 collapsible depth layers (Orientation / Understanding / Critique, grounded in Keshav three-pass + 5 C's + QALMRI + NeurIPS reviewer axes) + always-bilingual TR/EN glossary; **hybrid grounding** (`[S]` cited verbatim via `CitationChip` vs `[G]` flagged general-knowledge). **3 per-stage model bindings** in Settings → Default models (`analysisExtract`=Haiku · `analysisSynthesize`=Sonnet · `analysisCritique`=Sonnet, opt-up Opus), each pickable from any provider **incl. OpenRouter + custom model IDs** (reuses `ChatModelRow` `__custom__`). User-selectable output target language (default app locale). Generate modal uses **drag-and-drop PDF upload** (NOT a Sources picker — avoids mis-picking a non-article; `ingestPdfForAnalysis` in `lib/ingest/ingest-pdf-source` parse+chunk+persist, embedding deferred) + pre-run cost estimate + live per-stage progress + abortable. **PDF export** of a ready/draft analysis via `lib/article-analysis/pdf-export` (`exportAnalysisAsPdf`, themed A4 HTML → **browser print-to-PDF via a hidden iframe** — vector/selectable text, reliable in browser + Tauri webview; NOT html2pdf rasterization, layered sections + bilingual glossary). Detail-route dev rewrite added to `next.config.ts` `workspaceDevRewrites()` (the 404 fix). Reuses `getChatProvider().streamChat()` / `findChatOption` / `resolveChatCredentialForPreset` / `drainStream`+`estimateCost` (no new `/api` route, no new provider). New tables: `articleAnalyses` (Dexie **v29**, JSON-blob payload); **BackupV10** (legacy V6-V9 round-trip with `[]`); prefs **v24** (3 bindings, backfill migration). New `lib/article-analysis/{types,schema,token-budget}` + `lib/ai/{prompts/article-analysis,article-analysis}` (orchestrator) + `lib/ai/runners/article-analysis-runner` + `lib/db/article-analyses` + `components/article-analysis/{AnalysisGenerateModal,AnalysisCard,AnalysisEmptyState,AnalysisDetailView}` + `app/w/[id]/analysis/{page,[analysisId]/page}`. `route-params.ts` `DYNAMIC_CHILD` + `lib.rs` `DYN_PARENTS` (`analysis`). Built via multi-agent `Workflow` (research → A contract → B1 backend → B2 UI → B3 adversarial review, 9 findings fixed). **Vitest 1837 / 191 files** ✅ + typecheck ✅ + `cargo check`/test ✅. Spec: `docs/ARTICLE_ANALYSIS_SPEC.md`; detail in memory `project-article-analysis-design`.

**Workspace Chat ✅ 2026-06-18** — New workspace-level AI tutor at `/w/[id]/chat` (sidebar "Sohbet", icon `MessagesSquare`), DISTINCT from the single-source reader chat (which is untouched): multi-source RAG across ALL workspace chunks + **user-toggleable context chips** (📄 Kaynaklar default-on · 📝 Notlar · 🧠 Kavramlar · 🗺️ Roadmap · 🎯 Performans · 🌐 Web) injecting token-budgeted prompt blocks, with **hybrid grounding** (source-first + cite, flags general knowledge). Reuses provider/credential/`retrieval.topKChunks`/web-search layers + `ChatBubble`/`CitationChip` verbatim. New: `lib/ai/runners/workspace-chat-runner` (`useWorkspaceChat` hook) · `lib/ai/prompts/workspace-chat` · `lib/ai/context/{notes,concepts,roadmap,performance,budget,index}` · `components/notebook/{ContextBar,WorkspaceChatPanel}` · `app/w/[id]/chat/page`. DB reuses `chatThreads`/`chatMessages` (+ optional `scope`/`contextScopes`, **no migration**, backup auto-carries); `listChunksByWorkspace`/`listWorkspaceChatThreads` helpers. Leaf route → existing `segs[2]` rewrite in `lib.rs` (no `DYN_PARENTS` entry). `generate_flashcards`/`generate_quiz` tools omitted (no stubs; bypass the human-in-the-loop proposal modal). Built via multi-agent `Workflow` + adversarial-review fix-pass. **Vitest 1804 / 188 files** ✅ + typecheck ✅. Spec: `docs/WORKSPACE_CHAT_SPEC.md`; detail in memory `project_workspace_chat.md`. (`npm run lint` is pre-existing repo-wide red on `react-hooks/set-state-in-effect` — reader chat errors identically; green gates are tsc + vitest.)

**Phase 13 ✅ 2026-05-25 — Roadmap (replaces Plan)** — Plan calendar / .ics / reminder pipeline removed; new AI-authored prerequisite-DAG roadmaps live at `/w/[id]/roadmap` (list) + `/w/[id]/roadmap/[id]` (graph view). Multiple roadmaps per workspace, **Daily/Weekly/Monthly node budgets** (4-6 / 8-12 / 16-24), inline-nested subnodes capped at **depth 2**, optional workspace-concept grounding, user-picked model per wizard (Sonnet 4.6 default · Haiku / Opus opt-in). New tables: `roadmaps` / `roadmapNodes` / `roadmapEdges` (Dexie **v27**); `planBlocks` table dropped (**v28**). Backup bumped to **BackupV9** (no `planBlocks`; legacy v6-v8 backups round-trip with planBlocks discarded). Sidebar nav renamed Plan → Roadmap (icon `Route`). New `lib/roadmap/{types,schema,token-budget,source-context,layout}` + `lib/ai/{prompts/roadmap-gen,roadmap-gen}` + `lib/db/roadmaps.ts` + `components/roadmap/{RoadmapWizardModal,RoadmapCanvas,NodeInspector,RoadmapCard,RoadmapEmptyState}`. **Vitest 1679 / 172 files** ✅ + typecheck ✅. Spec: `docs/ROADMAP_FEATURE_SPEC.md`.

**Phase 4.5.H ✅ 2026-05-22** — AI curriculum hardening / draft-first refine is closed. `generateCurriculum` now always builds a deterministic source-grounded draft first; AI only refines title/objective/prerequisite/minutes. Source/chunk ids stay system-owned from the draft. Invalid JSON, parse failure, or hallucinated refs no longer surface "AI curriculum failed"; the draft is saved with `refineStatus: "draft"` and `fallbackReason`. UI cost/result copy separates free draft from paid AI refine. Verification: targeted RED→GREEN, `npm run typecheck` ✅, full Vitest **1707 / 170 files** ✅, touched-file ESLint ✅, `npm run build` ✅.

**Phase 9 ✅ 2026-05-18** — Master-password vault removed from BOTH Tauri AND web. Tauri already used OS keychain (Phase 8); web ran PBKDF2/AES with master password + `.tmekey` recovery. Web is dev-only now, so ~1500 LOC of crypto + UI wasn't worth maintaining. **14 files deleted** (`crypto/api-keys.ts`, `crypto/recovery.ts`, `crypto/keychain-migration.ts` + tests; `MasterPasswordModal`, `RecoveryModal`, `RecoveryKeyToggle`, `RecoverySection`, `KeychainMigrationSection`, `KeychainMigrationBoot`; 2 obsolete test files). `useVault` → trivial always-unlocked stub with **sentinel `masterKey: {} as CryptoKey`** so ~30 legacy `if (!masterKey)` gates become provably-dead code with zero per-callsite edits. `api-keys-repo.ts` 435 → 152 LOC; CRUD signatures drop `CryptoKey` arg. Dexie **v23 → v24** drops `vault` table + clears `apiKeys`; `ApiKeyRecord` reshaped to `{provider, plaintext, updatedAt}`. Filesystem vault (Phase 7.3+ `.md` sync) **untouched** — different concept sharing the name. Vitest **1642 → 1595 / 155 files** (-47 tests, all passing) · typecheck ✅ 0 errors. ~3h. → memory `project_phase9_plan.md`.

**Sentinel-stub key lesson:** for mass removal of a runtime gate read by 20+ sites, a constant non-null sentinel turns every `if (!gate)` into provably-dead code with zero edits per callsite. TS-only territory — sentinel never reaches the real API.

### Completed phases

`0` · `1` · `2` · `2.5` · `3.0–3.5+` · `4.A–F` (SRS / Flashcard / Quiz / Mind Map) · `4.5.A–H` (Guided Study, including draft-first curriculum hardening) · `5.A` (research providers) · `5.B.A–D` (podcast) · `5.C.A–C` (plan polish) · `5.5.A–G` (web search + provider chain) · `6.1–6.8` + `6.8.1` (Notes Layer) · `6.9.1–6.9.10` (Notes-as-Source) · `7.1` (Tauri scaffold) · `7.2` (16-provider client-side HTTP) · `7.3` (filesystem vault foundation) · `7.4.A–G` (two-way sync: primitives → watcher → reconcile → React mount → cascade → rename → cross-process lock + conflict undo) · `7.5.A–H` (Tauri release polish: notifier / tray / file assoc / menu / autostart / icon / updater / release.yml) · `8.A–E` (OS keychain BYOK) · `9` (master-password vault removed) · `10` (dynamic provider models) · `11.A` (TtsAdapter + Piper default + ElevenLabs out) · `11.B` (system probe + compat chip) · `11.C` (Settings TTS Model Manager + voice picker refactor + podcast feature toggle) · `11.D` (TTS stabilization, smoke helper, VRAM probe, heavy-provider guardrails).

**Full historical detail lives in memory:** `project_phase{45,5,55,6,69,7,8,9}_plan.md`. Do NOT re-summarise here.

### Tests / build state

- **Vitest:** 1707 tests / 170 files (post-Phase-4.5.H). Trajectory: Phase 9 → 1595, Phase 10 → 1648, Phase 11.A → 1647, Phase 11.B → 1675, Phase 11.C → 1687, Phase 4.5.H → 1707.
- **Playwright:** 22 E2E · serial ~75s · pre-existing `.first()` flakes in `guided-study.e2e.ts:176` + `plan.e2e.ts:139` masked by CI `retries: 2`.
- **`npm run typecheck`** ✅ 0 errors. **`cargo check`** ✅ for the Tauri Rust crate after Phase 11 sysinfo/tts work. **`npm run build`** ✅ after Phase 4.5.H.

### Release blockers (user-side)

1. `npx tauri signer generate` → replace PLACEHOLDER pubkey in `tauri.conf.json`.
2. GH Secrets `TAURI_SIGNING_PRIVATE_KEY` + `_PASSWORD`.
3. Updater endpoint repo URL.

(Branded icon ✅ 2026-05-18.)

### Maintenance — 2026-05-15

Next.js `16.2.4` → `16.2.6` (Vercel coordinated security release, 13 advisories / 12 CVEs; most critical CVE-2026-44578 WebSocket Upgrade SSRF CVSS 8.6 — self-hosted Node only). No regression: 968/968 Vitest + 16/17 Playwright (1 documented flake).

---

## Folder Structure

```
teach-me-everything/
├── CLAUDE.md                 ← This file
├── docs/                     ← PROJECT_INDEX, ARCHITECTURE, FEATURES, DESIGN_SYSTEM, MISSING, ROADMAP, PROVIDERS(_LOCAL), GUIDED_STUDY_CAPABILITY, RESEARCH_WEB_SEARCH_PROVIDERS, PHASE7_TAURI_QA
├── src-tauri/                ← Rust shell (keyring, agent_cli.rs, plugin-fs+watch, plugin-notification, plugin-autostart, plugin-updater, plugin-process, plugin-opener, tray-icon)
├── src/
│   ├── app/                  ← App Router (landing, dashboard, workspaces, /settings, /setup/[step], /api/ai/*, /w/[id]/* — /read/[sourceId], /chat, /notes, /cards, /quiz, /map, /research, /analysis(/[analysisId]), /roadmap(/[roadmapId]), /study/[lessonId], /study/journal, /audio/[podcastId])
│   ├── components/
│   │   ├── ui/               ← Button, Chip, Kbd, Input, Card, Switch, SegmentedControl, Modal, Toast, Tooltip, Skeleton, ConfirmDeleteModal, EmptyState, ThemeToggle
│   │   ├── shell/            ← AppShell, Sidebar, Topbar, TweaksPanel, Brand, MobileDrawer, BottomBar
│   │   ├── mounts/           ← headless mount-once side-effect components (render null): SeedBootstrap, UpdateCheckMount, TrayMount, MenuMount, DeepLinkMount, EventBridgeMount
│   │   ├── settings/         ← Backup, Quota, AILocale, CustomEndpoint(+Modal), Embed, Reembed, Cost, Concepts, ExtractConcepts, Vault, AutoLaunch, AgentCli, Updates, SearchProviders, WebSearch, TtsProvider, PodcastFeature, DailyNotes
│   │   ├── setup/            ← WelcomeStep, ExamplesStep, DoneStep, PresetChooser, FirstRunGate
│   │   ├── sources/          ← SourceUploader (PDF + DOCX queue), AddUrlModal (URL / DOI / YouTube / arXiv), PdfViewer
│   │   ├── notebook/         ← CitationChip, ChatBubble (+ToolActionBubble), ChatThreadSidebar, ContextBar, SourceScopePicker, WorkspaceChatPanel, WebCitationChip, WebCitationPeekModal
│   │   ├── workspaces/       ← WorkspaceCard, WorkspaceFormModal
│   │   ├── flashcards/       ← FlashcardEditModal, FlashcardProposalModal, GenerateBatchModal, LeechBadge
│   │   ├── srs/              ← IntervalHistogram
│   │   ├── quiz/             ← SessionReportModal
│   │   ├── concepts/         ← MindMapCanvas, ConceptInspector   (mind-map UI; pairs with lib/concepts/)
│   │   ├── study/            ← GenerateCurriculumModal, RegenerateLessonModal, SaveJournalEntryModal
│   │   ├── roadmap/          ← RoadmapWizardModal (3-step), RoadmapCanvas (SVG DAG), NodeInspector, RoadmapCard, RoadmapEmptyState
│   │   ├── article-analysis/ ← AnalysisGenerateModal, AnalysisCard, AnalysisEmptyState, AnalysisDetailView
│   │   ├── research/         ← SearchSourcesModal
│   │   ├── podcast/          ← GenerateScriptModal, CompatibilityChip, InstallModelModal
│   │   ├── notes/            ← NoteEditor, EditorToolbar, NoteTree, NoteTreeItem, NoteTreeContextMenu, BacklinksPanel, OutlinePanel, TagPanel, DeleteFolderModal, DeleteNoteModal, EmbedAsSource{Button,Menu}
│   │   ├── markdown/         ← MarkdownPreview (react-markdown + remark-gfm + citation chip)
│   │   ├── palette/          ← CommandPalette
│   │   ├── shortcuts/        ← ShortcutsHelpModal
│   │   ├── icons/            ← lucide-react barrel
│   │   └── vault/            ← VaultSetupModal, VaultSetupBoot, VaultReconcilerProvider, WorkspaceVaultMount  (filesystem `.md` vault — NOT the removed master-password vault)
│   ├── lib/
│   │   ├── db/               ← schema.ts (v30), types.ts, repos (api-keys, workspaces, sources, chunks, highlights, flashcards, chats, study, quiz-sessions, concepts, podcasts, notes, note-folders, roadmaps, article-analyses, cross-analyses), hooks.ts, seed.ts, fts.ts
│   │   ├── ai/               ← retrieval, tools, pricing, model-options, csp-origins, anthropic-credential; runners; prompts; providers (incl. claude-cli — spawns the local CLI, no HTTP); web-search
│   │   ├── research/         ← url-classifier, doi-fetch, youtube-fetch, arxiv-fetch, ingest, credential; providers; search/ (dispatch + 11 providers)
│   │   ├── notes/            ← parser, daily, outline, tree, tag-tree, wikilink-{resolver,rename,autocomplete}, live-preview/{cursor,decorations,tag-widget,wikilink-widget,...}, embed-as-source
│   │   ├── vault/            ← fs-adapter, normalise, hash, lock, atomic-write, watcher, watcher-suppression, note-path, reconcile, reconcile-dispatch, conflict-policy, cascade, process-lock, export
│   │   ├── tauri/            ← keychain.ts (Rust command bridge), agent-cli.ts (local agent CLI bridge, Channel-streamed), env (isTauriEnv + isTauriEnvWithOverride), reminder-notifier
│   │   ├── podcast/          ← types, voices, credential, tts, audio-assembly, synthesize
│   │   ├── roadmap/          ← types, schema (Zod), token-budget, source-context, layout (DAG force-sim)
│   │   ├── study/            ← types, export (Markdown), pdf-export
│   │   ├── quiz/             ← session (pure state machine)
│   │   ├── concepts/         ← layout (force-sim)
│   │   ├── srs/              ← sm2, session, streak
│   │   ├── ingest/           ← pdf, pdf-worker, docx, docx-worker, docx-html, chunker, embed-worker, reembed
│   │   ├── backup/           ← export, import (BackupV11 JSON, vault EXCLUDED, notes+noteFolders+podcasts+articleAnalyses+crossAnalyses INCLUDED, planBlocks DROPPED post-Phase-13, binary blobs EXCLUDED)
│   │   ├── article-analysis/ ← types, schema (Zod), token-budget (+buildArticleWindow), citation-verify, pdf-export
│   │   ├── cross-analysis/   ← types, refs (claim-ref table + grounding gate), matrix (pure, code-built), schema (Zod)
│   │   ├── storage/          ← quota, file-handle
│   │   └── utils/            ← cn, id (ULID-ish), intl, sanitize
│   ├── stores/               ← prefs.ts (v25, agentCli + searchProviders + vault.conflictPolicy + notesUi + analysis model bindings + …), vault.ts (trivial always-unlocked stub post-Phase-9)
│   ├── hooks/                ← useApiKeyManager
│   └── i18n/                 ← messages.ts, IntlProvider
├── tests/e2e/                ← Playwright (smoke, setup-wizard, notebook-happy-path, guided-study, add-url, podcast, plan, notes-create/wikilink/daily, notes-as-source-{create,sync}, diffbot-ingest, find-sources-modal, web-search-chat)
└── next.config.ts · eslint.config.mjs · postcss.config.mjs · tsconfig.json · playwright.config.ts · vitest.config.ts
```

---

## Stack (Locked Decisions)

- **Next.js 16.2.6 · App Router** — SSG landing + client-heavy app, static export for Tauri (`NEXT_OUTPUT_EXPORT=1`)
- **TypeScript strict** + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
- **Tailwind CSS v4** (`@theme` tokens; 3 themes via `data-theme`, **no `dark:` prefix**)
- **Zustand** + **TanStack Query**
- **Dexie.js v24** — no PostgreSQL, no server DB
- **Tauri 2.11.2** — desktop shell; `@tauri-apps/plugin-{http,fs,dialog,notification,autostart,updater,process,opener}`
- **CodeMirror 6** — notes editor (live preview widgets)
- **Anthropic SDK** + prompt caching + streaming + tool use
- **next-intl** (TR / EN)
- **pdf.js**, **mammoth**, local-first TTS via Piper sidecar, **Firecrawl / Exa / Tavily / Jina Reader / Readability / Diffbot / Bright Data / Brave**

**PostgreSQL forbidden.** Local-first → SQLite (Tauri) or IndexedDB (web) is enough.

---

## Working Style Rules

### Design fidelity
- `docs/DESIGN_SYSTEM.md` tokens are the single source of truth. Adding new colors / fonts is **forbidden** without first updating that doc.
- Check `docs/FEATURES.md` for the page before adding new pages.
- Icons via `lucide-react` (barrel imported).

### Next.js patterns
- Server components by default; `'use client'` only when interactive.
- Route handlers (`app/api/.../route.ts`) act as LLM proxies — keys never touch disk on web; Tauri build goes direct via `plugin-http`.
- Data fetch: TanStack Query + Dexie repo layer.
- Forms: React Hook Form + Zod.
- `next.config.ts` imports MUST be relative paths (no `@/` alias) — `feedback_next_config_relative_imports.md`.
- **Static-export dynamic routes:** any page under a runtime-id segment (`/w/[id]/...`) MUST read its params via `useRouteParams()` (`lib/utils/route-params.ts`), never bare `useParams()` — export only emits the `/w/_/...` shell so `useParams` returns the `_` placeholder. New dynamic segments also need a case in `export_shell_fallback` (`src-tauri/src/lib.rs`), which serves the `_` shell for runtime ids. **AND a two-level child route (`/w/[id]/<parent>/[childId]`) MUST get an explicit rewrite in `next.config.ts` `workspaceDevRewrites()`** (`/w/:id/<parent>/:childId → /w/_/<parent>/_?workspaceId=:id&childId=:childId`) — without it the catch-all `/w/:id/:path*` leaves the real child id in the path and **`npm run dev` 404s the detail route** (the `_` shell + `dynamicParams:false` only matches `_`). Also add `<parent>` to `DYNAMIC_CHILD` in `route-params.ts`. See `feedback_static_export_dynamic_route_404.md`.

### Local-first
- All CRUD goes through client-side Dexie. No server state.
- **BYOK keys:** Tauri → OS keychain via `keyring-rs`; web (dev-only) → Dexie plaintext.
- If an idea pulls toward "use PostgreSQL / Supabase" — back away.

### Commit & branching
- `main` must always work.
- Feature branches: `feat/notebook-chat`, `fix/srs-interval`
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Every PR must pass CI (tsc, eslint, vitest).

### Code style
- `tsconfig.json` strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (conditional spread for optional fields under `exactOptional` — `feedback_exactoptional_fetch_signal.md`).
- `import '@/...'` alias — `../../../` forbidden (except in `next.config.ts`).
- Explicit type signatures on public fns / classes.
- Comments only for WHY (not WHAT).
- Pure functions require Vitest tests (SRS, chunker, schedulers, quiz state machine, concept layout, iCal builder, audio-assembly, reminder-scheduler, vault primitives).
- Production Tauri gating MUST use `isTauriEnvWithOverride()` — `feedback_istauri_override_in_prod.md`.

### File placement conventions

- **Tests are colocated** — `Foo.ts` → `Foo.test.ts` beside it. **No `__tests__/` folders** (all 22 were removed 2026-08-03; the repo had a 2:1 colocated/`__tests__` split with no rule). One test file per module: if you need both pure-fn and DOM cases, put them in one `.test.tsx` as separate `describe` blocks — don't add a second `.test.ts` differing only by extension. `vitest.config.ts` `environmentMatchGlobs` picks jsdom off `src/components/**/*.test.tsx`, so **component tests must be `.tsx`** to get a DOM.
- **A component graduates out of its route file** once it is (a) used by more than one route, **or** (b) independently testable, **or** (c) pushes the page past ~600 lines. Route-private helpers below that bar may stay in `page.tsx`. Six pages currently exceed it (`read/[sourceId]` 2.7k, `settings` 1.8k, `w/[id]` 1.6k, `quiz`, `research`, `cards`) — treat those as debt, not precedent, and extract when you next touch them.
- **`components/<feature>/`** is named after the domain, not the route (`concepts/` not `mindmap/`, matching `lib/concepts/`). One-file folders get merged into their nearest sibling.
- **`components/mounts/`** holds headless "mount once at a layout root and wire a side effect" components that `return null`. If it renders UI, it belongs to its feature folder instead (that's why `VaultSetupBoot` stays in `vault/` — it owns a modal).

---

## AI / Claude API Usage

**On every AI call:**
1. **Prompt caching** — source text in system prompt with `cache_control: { type: 'ephemeral' }`.
2. **Streaming** by default; client consumes `ReadableStream`.
3. **Model selection (via `prefs.modelBindings`):**
   - Deep Q&A, podcast script, curriculum: `claude-opus-4-7`
   - Standard chat, flashcard / quiz gen, rerank: `claude-sonnet-4-6`
   - Short summary, tag, title: `claude-haiku-4-5-20251001`
4. **Tool use** in notebook chat: `add_flashcard`, `open_citation`, `simplify_explanation`.
5. **Token tracking** via `response.usage`, surface cost in UI.

System prompts live under `lib/ai/prompts/` — versioned, tested.

**Forbidden:** Never log user prompts / responses · Never echo API key in response bodies · No mock / stub paths in production · **No telemetry, ever** (`feedback_no_telemetry.md`).

---

## Command Reference

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm test              # Vitest watch
npm run test:run      # CI
npm run test:e2e      # Playwright
npm run build && npm run start
# Tauri
npm run tauri:dev
npm run tauri:build
```

---

## Important Links

- **Claude API docs:** https://docs.claude.com/en/api/
- **Next.js App Router:** https://nextjs.org/docs/app
- **Tailwind v4:** https://tailwindcss.com/docs
- **Dexie:** https://dexie.org/
- **Tauri 2:** https://tauri.app/
- **pdf.js:** https://mozilla.github.io/pdf.js/
- **SM-2:** https://super-memory.com/english/ol/sm2.htm
- **FSRS v5:** https://github.com/open-spaced-repetition/fsrs4anki

---

## Notes for Claude

1. **Read `docs/` first** — `FEATURES.md` for the page, `PROJECT_INDEX.md` for broad context, `PHASE7_TAURI_QA.md` for manual smoke before release.
2. **Follow `MISSING.md`'s priority table.**
3. **Server vs client split clean** — no needless `'use client'`.
4. **Sketch a small plan (3–5 bullets)** before changing code.
5. **Local-first** — if you want server state, document why first.
6. **TR / EN every string** via i18n — no hardcoded text.
7. **Don't change design tokens / fonts** — `DESIGN_SYSTEM.md` is the gate. 4 themes (white / sepia / dark / github) cascade via `data-theme`; don't use `dark:` prefix.
8. **BYOK security is conservative** — when in doubt, ask. Tauri uses OS keychain; web is dev-only plaintext.
9. **Open-source mindset** — friendly errors, README screenshots, demo GIFs.
10. **Phase detail lives in memory** — `memory/project_phase{45,5,55,6,69,7,8,9}_plan.md`. Pull from there before re-deriving context; don't re-bloat this file.
11. **Site copy bans** — never use "hacklenebilir/hackable" (`feedback_site_copy_no_hackable.md`).
12. **No cloud deploy** — Vercel/Netlify/CF Pages forbidden (`feedback_no_cloud_deploy.md`).

---

## Glossary

| Term | Meaning |
|---|---|
| Workspace | Source set for one topic / project (e.g. "Quantum Field Theory") |
| Source | A source document (PDF, arXiv, URL, YouTube, note) |
| Chunk | Parsed text fragment from a source (500–1000 tokens) |
| Highlight | User highlight (chunk + span + userNote) |
| SRS | Spaced Repetition System (SM-2 / FSRS) |
| Flashcard | Q&A card + SM-2 state |
| Feynman | User explains topic out loud; AI gives feedback |
| Backlink | Concept → source quote in mind map, or wikilink reverse-ref in notes |
| BYOK | Bring Your Own Key |
| Vault | Two senses: (a) **filesystem vault** = workspace `.md` folder synced both ways (Phase 7.3+, alive); (b) **master-password vault** = removed in Phase 9. |
| Wikilink | `[[target]]` / `[[source:id]]` / `[[concept:id\|alias]]` cross-entity ref in notes |
| Daily note | `Daily-{date}.md` idempotent per-day note created by `findOrCreateDailyNote` |

---

**Last updated:** 2026-05-22 · **v1.0.0-rc12 phase11d-plus-45h** · Phase 0–11.D ✅ plus Phase 4.5.H ✅ · Vitest **1707 / 170 files** + Playwright **22 E2E** · typecheck/build/cargo check 0 errors. Current next: Phase 11 manual smoke/release gate → Phase 12 heavy local TTS runtime POCs.
