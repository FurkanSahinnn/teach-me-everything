<!-- Generated: 2026-08-03 | Files scanned: 612 | Token estimate: ~900 -->

# Frontend

Next.js 16 App Router. Server components by default; `'use client'` only where interactive. 105 components, 40 route files.

## Route Tree — `src/app/`

```
/                          page.tsx          landing (SSG)
/dashboard                                   activity + due-cards overview
/workspaces                                  workspace grid
/settings                                    all settings sections
/setup/[step]              + layout          first-run wizard
/w/[id]                    + layout          workspace home (sources list)
  /read/[sourceId]         + layout          reader + per-source chat
  /chat                                      workspace chat (multi-source RAG)
  /analysis                                  analysis list
    /[analysisId]          + layout          analysis detail (3 depth layers)
  /roadmap                                   roadmap list
    /[roadmapId]           + layout          DAG canvas + inspector
  /study/[lessonId]        + layout          guided lesson
  /study/journal                             journal entries
  /cards                                     flashcards / SRS review
  /quiz                                      quiz session
  /map                                       mind map
  /notes                                     CodeMirror notes workspace
  /audio/[podcastId]       + layout          podcast player
  /research                                  find + add sources
error.tsx · not-found.tsx · layout.tsx (IntlProvider, theme script, mounts)
```

**Dynamic-route rule:** every page under `/w/[id]` reads params via `useRouteParams()` ([lib/utils/route-params.ts](src/lib/utils/route-params.ts)) — never bare `useParams()`. Static export emits only the `/w/_/…` shell.

## Component Groups — `src/components/`

| Group | Notable |
|---|---|
| `ui/` (14) | Button, Chip, Card, Input, Modal, Toast, Tooltip, Switch, SegmentedControl, Skeleton, Kbd, EmptyState, ConfirmDeleteModal, ThemeToggle |
| `shell/` (8) | AppShell, Sidebar, Topbar, TweaksPanel, MobileDrawer, BottomBar, Brand, UpdateCheckMount |
| `notebook/` (8) | ChatBubble, CitationChip, WebCitationChip, WebCitationPeekModal, ContextBar, WorkspaceChatPanel, ChatThreadSidebar, SourceScopePicker |
| `notes/` (12) | NoteEditor (CM6), EditorToolbar, NoteTree(+Item,+ContextMenu), BacklinksPanel, OutlinePanel, TagPanel, EmbedAsSource{Button,Menu}, Delete{Note,Folder}Modal |
| `article-analysis/` (4) | AnalysisGenerateModal (drag-drop PDF), AnalysisDetailView, AnalysisCard, AnalysisEmptyState |
| `roadmap/` (5) | RoadmapWizardModal (3-step), RoadmapCanvas (SVG DAG), NodeInspector, RoadmapCard, RoadmapEmptyState |
| `settings/` (17) | Backup, Quota, AILocale, CustomEndpoint(+Modal), Embed, Reembed, Cost, Concepts(+Extract), Vault, AutoLaunch, Updates, SearchProviders, WebSearch, DailyNotes, TtsProvider, PodcastFeature |
| `mindmap/`, `flashcards/`, `quiz/`, `study/`, `podcast/`, `sources/`, `research/`, `workspaces/`, `setup/`, `vault/`, `tray/`, `srs/`, `cards/`, `palette/`, `markdown/`, `shortcuts/` | feature-local |

## State Management

```
Zustand
  stores/prefs.ts      v24 · persisted · modelBindings (incl. 3 analysis
                       bindings), locale, theme, searchProviders, vault,
                       notesUi, cost, dailyNotes, podcast toggles
  stores/selection.ts  transient reader/UI selection
  stores/vault.ts      Phase-9 stub — always-unlocked sentinel masterKey

Dexie live queries
  lib/db/hooks.ts      55 useX() hooks via dexie-react-hooks
                       → components re-render on IDB writes, no cache layer

TanStack Query        AI generation / network calls only
React Hook Form + Zod Forms
```

`src/hooks/`: `useApiKeyManager` · `useProviderChatModels` · `useSystemCheck` · `useCurrentTime`.

## Rendering / Editor Stack

- **Markdown**: [components/markdown/MarkdownPreview.tsx](src/components/markdown/MarkdownPreview.tsx) — react-markdown + remark-gfm/math + rehype-katex/highlight + citation chips. Document preview uses `markdown-it` (VS Code engine parity) via [lib/markdown/render.ts](src/lib/markdown/render.ts) with `balance-code-fences` + `remark-no-indented-code` repairs.
- **Notes editor**: CodeMirror 6 with live-preview widgets — `lib/notes/live-preview/{cursor-aware,heading-widget,inline-marks,list-widgets,tag-widget,wikilink-widget}`.
- **PDF**: `pdfjs-dist` canvas + textLayer in [sources/PdfViewer.tsx](src/components/sources/PdfViewer.tsx).
- **Graphs**: hand-rolled force-sim layouts — `concepts/layout.ts`, `roadmap/layout.ts` → SVG canvases.
- **PDF export**: themed A4 HTML → hidden-iframe browser print (vector text), `article-analysis/pdf-export.ts` + `study/pdf-export.ts`.

## Design System

`docs/DESIGN_SYSTEM.md` is the single source of truth. Tailwind v4 `@theme` tokens; 3 themes via `data-theme` cascade — **no `dark:` prefix**. Icons: `lucide-react`. Adding colors/fonts requires updating that doc first.
