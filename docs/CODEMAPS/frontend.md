# Frontend codemap

Next.js 16 App Router, React 19, Tailwind v4. Every page is a client-driven screen reading Dexie via hooks; there is no server data fetching. Design tokens and themes: [DESIGN_SYSTEM](../DESIGN_SYSTEM.md). Runtime modes: [architecture](architecture.md).

## Routes (`src/app/`)

| Route | File | Notes |
|---|---|---|
| `/` | `page.tsx` | Landing; wraps `FirstRunGate` |
| `/dashboard` | `dashboard/page.tsx` | |
| `/workspaces` | `workspaces/page.tsx` | Workspace list (`components/workspaces/`) |
| `/settings` | `settings/page.tsx` | Composes `components/settings/*` sections |
| `/setup/[step]` | `setup/[step]/{layout,page}.tsx` | First-run wizard (`components/setup/`) |
| `/w/[id]` | `w/[id]/page.tsx` | Workspace home; `layout.tsx` exports `generateStaticParams` yielding only `{id:"_"}` and `dynamicParams = false`, mounts `WorkspaceVaultMount` |
| `/w/[id]/read/[sourceId]` | `read/[sourceId]/{layout,page}.tsx` | Reader + source chat (`PdfViewer`, `TweaksPanel`) |
| `/w/[id]/chat` | `chat/page.tsx` | Multi-source workspace chat (`WorkspaceChatPanel`) |
| `/w/[id]/notes` | `notes/page.tsx` | Markdown notes (CodeMirror 6) |
| `/w/[id]/cards` | `cards/page.tsx` | Flashcards / SRS |
| `/w/[id]/quiz` | `quiz/page.tsx` | |
| `/w/[id]/map` | `map/page.tsx` | Concept mind map |
| `/w/[id]/research` | `research/page.tsx` | |
| `/w/[id]/study/[lessonId]`, `/w/[id]/study/journal` | `study/[lessonId]/{layout,page}.tsx`, `study/journal/page.tsx` | Guided curriculum |
| `/w/[id]/audio/[podcastId]` | `audio/[podcastId]/{layout,page}.tsx` | Podcast player |
| `/w/[id]/roadmap`, `/w/[id]/roadmap/[roadmapId]` | `roadmap/page.tsx`, `roadmap/[roadmapId]/{layout,page}.tsx` | Prerequisite DAG |
| `/w/[id]/analysis`, `/w/[id]/analysis/[analysisId]` | `analysis/page.tsx`, `analysis/[analysisId]/{layout,page}.tsx` | Article analysis |

Also `layout.tsx` (fonts, providers, mounts), `error.tsx`, `not-found.tsx`, `globals.css`.

Rules for dynamic routes: pages under `/w/[id]/...` read params with `useRouteParams()` (`src/lib/utils/route-params.ts`, `DYNAMIC_CHILD` map), never bare `useParams()`. Every `[childId]` directory has a `layout.tsx` that pre-renders only the `_` placeholder. A new two-level route must also be added to `workspaceDevRewrites()` in `next.config.ts` and `DYN_PARENTS` in `src-tauri/src/lib.rs`. See [STATIC_EXPORT_WORKSPACE_ROUTING](../STATIC_EXPORT_WORKSPACE_ROUTING.md).

## Components (`src/components/<domain>/`)

| Dir | Main components |
|---|---|
| `shell/` | `AppShell`, `Sidebar`, `Topbar` (hosts `CommandPalette`, `ShortcutsHelpModal`), `BottomBar`, `MobileDrawer`, `Brand`, `TweaksPanel` |
| `ui/` | Primitives: `Button`, `Card`, `Chip`, `Input`, `Modal`, `ConfirmDeleteModal`, `EmptyState`, `Kbd`, `SegmentedControl`, `Skeleton`, `Switch`, `ThemeToggle`, `Toast` (`ToastProvider`), `Tooltip` |
| `notebook/` | Chat UI: `WorkspaceChatPanel`, `ChatBubble`, `ChatThreadSidebar`, `ContextBar`, `SourceScopePicker`, `CitationChip`, `WebCitationChip`, `WebCitationPeekModal` |
| `sources/` | `SourceUploader`, `AddUrlModal`, `PdfViewer` |
| `research/` | `SearchSourcesModal` |
| `notes/` | `NoteEditor`, `NoteTree` (+ item/context menu), `EditorToolbar`, `OutlinePanel`, `BacklinksPanel`, `TagPanel`, `EmbedAsSource*`, delete modals |
| `flashcards/`, `srs/`, `quiz/` | `FlashcardEditModal`, `FlashcardProposalModal`, `GenerateBatchModal`, `LeechBadge`; `IntervalHistogram`; `SessionReportModal` |
| `concepts/` | `MindMapCanvas`, `ConceptInspector` |
| `study/` | `GenerateCurriculumModal`, `RegenerateLessonModal`, `SaveJournalEntryModal` |
| `podcast/` | `GenerateScriptModal`, `InstallModelModal`, `CompatibilityChip` |
| `roadmap/` | `RoadmapCanvas`, `NodeInspector`, `RoadmapCard`, `RoadmapEmptyState`, `RoadmapWizardModal` |
| `article-analysis/` | `AnalysisDetailView`, `AnalysisCard`, `AnalysisGenerateModal`, `AnalysisEmptyState` |
| `settings/` | One `*Section.tsx` per settings block (AgentCli, Backup, Vault, Embed, WebSearch, SearchProviders, CustomEndpoint, Cost, Quota, Updates, AutoLaunch, TtsProvider, ...) plus `ReembedModal`, `ExtractConceptsModal` |
| `setup/` | `FirstRunGate`, `WelcomeStep`, `PresetChooser`, `ExamplesStep`, `DoneStep` |
| `workspaces/` | `WorkspaceCard`, `WorkspaceFormModal` |
| `vault/` | `VaultSetupBoot`, `VaultSetupModal`, `WorkspaceVaultMount`, `VaultReconcilerProvider` |
| `palette/`, `shortcuts/`, `markdown/`, `icons/` | `CommandPalette` (cmdk), `ShortcutsHelpModal`, `MarkdownPreview`, icon re-exports |

### `mounts/` (headless, render `null`, mounted once)

`TrayMount`, `DeepLinkMount`, `MenuMount`, `EventBridgeMount`, `UpdateCheckMount` are mounted in `src/app/layout.tsx`; `SeedBootstrap` in `AppShell`. `TrayMount`, `MenuMount` and `DeepLinkMount` subscribe to native Tauri events and re-dispatch them as window CustomEvents; `EventBridgeMount` routes those to app actions (navigation, create note, daily note, sidebar toggle via `SIDEBAR_TOGGLE_EVENT`). They no-op outside Tauri (`isTauriEnv`).

## State, hooks, i18n

- `src/stores/prefs.ts`: persisted user preferences (`usePrefs`, key `tme:prefs`); see [data](data.md). `selection.ts`: ephemeral reader text selection (`useSelection`). `vault.ts`: constant "unlocked" stub kept for legacy call sites (the master-password vault is removed); not the `.md` folder vault in `lib/vault`.
- `src/lib/db/hooks.ts`: Dexie live-query hooks (`use*`), the main data access path for components.
- `src/hooks/`: `useApiKeyManager`, `useProviderChatModels`, `useSystemCheck`, `useHydrated`, `useCurrentTime`.
- `src/i18n/IntlProvider.tsx` (`IntlProvider`, `useLocalePick`) and `messages.ts` (`getMessages`, typed from `messages/en.json`); catalogs `messages/tr.json` and `messages/en.json`. All UI text goes through next-intl; locale comes from `usePrefs().locale`.
- Imports use the `@/` alias; component tests are `.tsx` and sit next to the component.
