<!-- Generated: 2026-08-03 | Files scanned: 612 (607 ts/tsx + 5 rs) | Token estimate: ~750 -->

# Architecture

**Teach Me Everything (TME)** — local-first active-learning workspace. Next.js 16 App Router + Tauri 2 desktop shell. No server database, no cloud deploy.

## System Shape

```
┌─────────────────────────────────────────────────────────┐
│  UI  src/app (routes) + src/components (105 .tsx)       │
│      Zustand (prefs v24, selection, vault) · TanStack Q  │
└───────────────┬─────────────────────────────────────────┘
                │ repo fns + dexie-react-hooks (55 live hooks)
┌───────────────▼─────────────────────────────────────────┐
│  DOMAIN  src/lib/{ai,notes,vault,srs,roadmap,article-   │
│          analysis,podcast,quiz,research,ingest,study}   │
└───────┬───────────────────────────┬─────────────────────┘
        │                           │
┌───────▼──────────┐      ┌─────────▼──────────────────┐
│ Dexie v29 (IDB)  │      │ LLM / search providers      │
│ 26 tables        │      │ web: /api/ai/* proxy        │
│ src/lib/db       │      │ tauri: plugin-http direct   │
└──────────────────┘      └────────────────────────────┘
                          ┌────────────────────────────┐
                          │ Rust: keychain, sysinfo,   │
                          │ tts(piper), fs watcher     │
                          └────────────────────────────┘
```

## Two Runtime Targets

| | Web (dev-only) | Tauri (shipped) |
|---|---|---|
| Build | `next build` | `NEXT_OUTPUT_EXPORT=1` static export |
| LLM calls | `/api/ai/*` route handlers (edge/node) | `plugin-http` direct, no proxy |
| BYOK keys | Dexie plaintext `apiKeys` | OS keychain via `keyring-rs` |
| Filesystem vault | unavailable | `plugin-fs` + watcher |
| Route params | `useParams()` works | `useRouteParams()` REQUIRED (`_` shell) |

Runtime gate: `isTauriEnvWithOverride()` — [src/lib/tauri/env.ts](src/lib/tauri/env.ts). Production gating must use the `WithOverride` variant.

## Feature Surfaces (workspace-scoped)

| Surface | Route | Domain lib |
|---|---|---|
| Reader + source chat | `/w/[id]/read/[sourceId]` | `ai/retrieval`, `ai/prompts/notebook-chat` |
| Workspace chat (multi-source) | `/w/[id]/chat` | `ai/runners/workspace-chat-runner`, `ai/context/*` |
| Article Analysis | `/w/[id]/analysis[/[analysisId]]` | `ai/article-analysis`, `article-analysis/*` |
| Roadmap (DAG) | `/w/[id]/roadmap[/[roadmapId]]` | `roadmap/*`, `ai/roadmap-gen` |
| Guided Study | `/w/[id]/study/[lessonId]`, `/study/journal` | `ai/curriculum-generation`, `study/*` |
| Flashcards / SRS | `/w/[id]/cards` | `srs/{sm2,session,streak}` |
| Quiz | `/w/[id]/quiz` | `quiz/session` (pure FSM) |
| Mind map | `/w/[id]/map` | `concepts/layout`, `ai/concept-extraction` |
| Notes | `/w/[id]/notes` | `notes/*`, `vault/*` (2-way `.md` sync) |
| Podcast | `/w/[id]/audio/[podcastId]` | `podcast/*` (Piper sidecar TTS) |
| Research / add sources | `/w/[id]/research` | `research/*` (11 search + 7 extract providers) |

## Cross-Cutting Invariants

- **No PostgreSQL / no server state.** All CRUD via `src/lib/db/*` repos → Dexie.
- **No telemetry.** Never log prompts, responses, or keys.
- **BYOK everywhere** — no bundled keys; `apiKeys` table or OS keychain.
- **i18n TR/EN** via `next-intl`; every string through `src/i18n/messages.ts`.
- **4 themes** (white/sepia/dark/github) via `data-theme`, never `dark:` prefix.
- **Static-export dynamic routes**: two-level child routes need `workspaceDevRewrites()` in [next.config.ts](next.config.ts) + `DYNAMIC_CHILD` in [route-params.ts](src/lib/utils/route-params.ts) + `DYN_PARENTS` in [lib.rs](src-tauri/src/lib.rs).

## Verification Gates

`npm run typecheck` · `npm run test:run` (195 test files) · `npm run test:e2e` (17 Playwright specs) · `cargo check`. `npm run lint` is pre-existing repo-wide red on `react-hooks/set-state-in-effect` — not a gate.

## See Also

[backend.md](backend.md) · [frontend.md](frontend.md) · [data.md](data.md) · [dependencies.md](dependencies.md)
