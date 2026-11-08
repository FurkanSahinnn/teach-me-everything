# CLAUDE.md — Teach Me Everything

Guide for Claude Code and other coding agents working in this repo. Keep it short: design detail belongs in
`docs/`, not here.

## What this is

Teach Me Everything (TME) is an open-source (MIT), local-first study workspace for active learning. Users add
PDFs, DOCX, URLs, arXiv/DOI papers, YouTube transcripts and notes. From these they chat with an AI tutor and
generate flashcards (SM-2), quizzes (MCQ, open-ended, mixed), mind maps, two-host podcasts, guided-study
curricula, prerequisite roadmaps and multi-stage paper analyses.

Non-negotiables:
- **Local-first.** All user data stays on the device in IndexedDB (Dexie). No PostgreSQL, Supabase or server DB.
  If a change seems to need server state, stop and write down why first.
- **BYOK.** Users bring their own keys. Desktop stores them in the OS keychain; the web build is dev-only and
  keeps them in Dexie.
- **No cloud deploy.** The product ships as Tauri desktop installers on GitHub Releases. No Vercel, Netlify or
  Cloudflare Pages.
- **No telemetry.** Never log prompts, responses or keys. Never echo a key in a response body.
- **TR/EN.** Every UI string goes through i18n. Turkish is a first-class source and UI language.

## Commands

```bash
npm install            # also downloads the Piper TTS sidecar (postinstall)
npm run dev            # web dev server, http://localhost:3000
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint 9 flat config
npm run test:run       # Vitest, single run (npm test = watch)
npx vitest run path/to/file.test.ts
npm run test:e2e       # Playwright; starts npm run dev itself
npm run build          # Next build (web)
npm run build:export   # static export used by Tauri (NEXT_OUTPUT_EXPORT=true)
npm run tauri:dev      # desktop app in dev
npm run tauri:build    # desktop installers
cargo test --manifest-path src-tauri/Cargo.toml --offline
```

On Windows PowerShell use `npm.cmd` if `npm` is blocked by the execution policy.

There is no PR CI workflow (only `.github/workflows/release.yml`). Run typecheck, lint and `test:run` yourself,
plus the Rust tests for native changes. Never pipe a gate command through `tail`/`head`: the pipeline reports the
last command's exit code and hides failures.

## Read before changing

| Need | Doc |
|---|---|
| Overview, routes, glossary, schema versions | [docs/PROJECT_INDEX.md](docs/PROJECT_INDEX.md) |
| How the system fits together | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| What a page does | [docs/FEATURES.md](docs/FEATURES.md) |
| Tokens, themes, UI primitives | [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) |
| Cloud provider setup, pricing table | [docs/PROVIDERS.md](docs/PROVIDERS.md) |
| Local runtimes, Claude/Codex CLI providers | [docs/PROVIDERS_LOCAL.md](docs/PROVIDERS_LOCAL.md) |
| Adding a route under `/w/[id]` | [docs/STATIC_EXPORT_WORKSPACE_ROUTING.md](docs/STATIC_EXPORT_WORKSPACE_ROUTING.md) |
| Where a file or symbol lives | [docs/CODEMAPS/](docs/CODEMAPS/architecture.md) |

## Repo map

- `src/app/` — App Router pages; workspace pages under `src/app/w/[id]/`; `src/app/api/ai/*` are LLM proxies used
  only by the web dev build.
- `src/components/<domain>/` — UI grouped by domain (`notebook`, `notes`, `roadmap`, `article-analysis`,
  `settings`, `ui`, `shell`, …). `components/mounts/` holds headless mount-once side-effect components.
- `src/lib/` — domain logic: `ai/` (providers, runners, prompts, retrieval, pipelines), `db/` (Dexie schema +
  repos + hooks), `ingest/`, `notes/`, `vault/`, `srs/`, `quiz/`, `roadmap/`, `article-analysis/`,
  `cross-analysis/`, `research/`, `podcast/`, `backup/`, `tauri/` (Rust bridges), `utils/`.
- Settings are static routes under `src/app/settings/<section>/` built from `SettingsPage` / `SettingsSection` /
  `SettingsGroup` / `SettingsRow` (`src/components/settings/layout/`); a new section is registered in `settings-nav.ts`.
- `src/stores/` — Zustand (`prefs.ts` persisted with migrations). `src/i18n/` + `messages/{tr,en}.json`.
- `src-tauri/` — Rust shell: `lib.rs` (plugins, commands, asset fallback), `agent_cli.rs` + `agent_process.rs`,
  `keychain.rs`, `tts.rs`, `sysinfo.rs`; permissions in `capabilities/default.json` + `permissions/*.toml`.
- `tests/e2e/` — Playwright specs (`*.e2e.ts`). `scripts/` — Piper fetch, release check, routing repro.

## Conventions

**TypeScript.** Strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`: add optional fields with a
conditional spread instead of assigning `undefined`. Import with the `@/` alias; no `../../../`. Exception:
`next.config.ts` and every file it imports (for example `src/lib/ai/csp-origins.ts`) use relative imports, because
the config runs without the alias resolver. Exported functions declare their types. Comments explain why, not what.

**Next.js and static export.** Pages under `/w/[id]` read params with `useRouteParams()` from
`src/lib/utils/route-params.ts`, never bare `useParams()` (the export only contains `_` placeholders). Add
`'use client'` only where needed. Gate desktop behaviour with `isTauriEnvWithOverride()`.

**Data.** All CRUD goes through the Dexie repos in `src/lib/db/`; components read through `src/lib/db/hooks.ts`.
Schema versions are append-only. A table that must survive backup also needs `src/lib/backup` changes and a bump of
`BACKUP_SCHEMA_VERSION`.

**Tests.** Colocated: `foo.ts` → `foo.test.ts`, no `__tests__/` folders, one test file per module. Component tests
must be `.tsx` (jsdom is selected by `vitest.config.ts` `environmentMatchGlobs`). Pure logic (SRS, chunker, quiz state
machine, layouts, vault primitives, migrations) needs Vitest coverage. Bug fixes start with a failing test.

**Components.** A component leaves its route file once it is used by more than one route, is independently
testable, or pushes the page past ~600 lines. Several large pages (`read/[sourceId]`, `settings`, `w/[id]`) already
exceed this: extract when you touch them, do not add to them. Folders are named after the domain, not the route.

**UI.** Design tokens in `src/app/globals.css` and [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) are the gate: no new
colors or fonts without updating both. Themes switch with `data-theme`; never use the `dark:` prefix. Icons come from
`lucide-react` via `src/components/icons`. Site copy never says "hackable" / "hacklenebilir".

**AI.** Prompt builders live in `src/lib/ai/prompts/`. Go through `getChatProvider(id).streamChat()` and the existing
credential helpers; do not add a new `/api` route or provider path for a feature. Credential gates use
`presetIsKeyless()`, not `isLocalUrl()` alone. Model defaults come from `DEFAULT_MODEL_BINDINGS` in
`src/stores/prefs.ts`; do not hard-code model ids in features. No mock or stub code paths in production.

**Git.** `main` must always work. Branches `feat/…`, `fix/…`. Conventional commits (`feat:`, `fix:`, `refactor:`,
`docs:`, `test:`, `chore:`, `perf:`, `ci:`).

## Gotchas

- A new two-level route `/w/[id]/<parent>/[childId]` needs four registrations or it 404s in dev or in the packaged
  app: `workspaceDevRewrites()` in `next.config.ts`, `DYNAMIC_CHILD` in `route-params.ts`, `DYN_PARENTS` in
  `src-tauri/src/lib.rs`, and a `[childId]/layout.tsx` whose `generateStaticParams` returns only `_`.
- A new `#[tauri::command]` is denied until it has a `permissions/*.toml` entry and an identifier in
  `capabilities/default.json`. `invoke` then rejects with a bare string, so `err instanceof Error` loses the reason.
- A new cloud provider host: the web CSP picks it up from the presets automatically, but the Tauri plugin-http
  allow list in `capabilities/default.json` must be edited by hand.
- Prefs migrations (`src/stores/prefs.ts`) reset `modelBindings` to defaults when a strict shape check fails. Patch new
  fields in place in their own version step and add a migration test.
- Local agent CLI providers (`claude-cli`, `codex-cli`) have an empty `baseUrl` and `externalAuth: true`; their family
  is `agent-cli`, never `anthropic` (which means "build an HTTP request").
- Chat requests belong to `ChatSession` (`src/lib/ai/runners/chat-session.ts`), not to the React view: unmounting must
  not abort a stream.
- Re-chunking a source does not migrate saved chunk references; citations into old chunks can break.
- "Vault" means the filesystem `.md` folder sync (`src/lib/vault`). The master-password vault was removed; the stub in
  `src/stores/vault.ts` only keeps old call sites compiling.
