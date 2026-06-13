# Static Export Workspace Routing

Date: 2026-06-13

## Summary

Workspace routes use runtime-generated IDs such as `/w/ws_xxx`, but the Tauri
desktop build uses Next.js static export mode. Static export cannot know user
created workspace IDs at build time, so the app only emits placeholder shells:

```text
/w/_
/w/_/cards
/w/_/read/_
/w/_/audio/_
/w/_/roadmap/_
/w/_/study/_
/w/_/study/journal
```

If a real route like `/w/ws_xxx` reaches Next/Tauri without a fallback, Next
treats it as an ungenerated dynamic route and shows the global 404 page.

This issue is unrelated to GitHub release signing secrets or updater keys.
Signing keys only verify updater artifacts; they do not affect app routing or
Dexie workspace records.

## Symptom

Selecting any workspace, including a newly created one, navigates to the global
404 screen:

```text
404
Sayfa bulunamadi
```

The failure can happen even when the workspace exists in IndexedDB. In that
case, the route shell failed before the client-side workspace lookup could run.

## Root Cause

The parent workspace segment is configured for static export:

- `src/app/w/[id]/layout.tsx`
- `generateStaticParams()` returns only `{ id: "_" }`
- `dynamicParams = false`

With `dynamicParams = false`, Next.js serves only generated params. In dev or
server mode, navigating to `/w/<real-id>` directly 404s unless the request is
rewritten to the placeholder shell. In packaged Tauri/static mode, the asset
resolver also needs to serve `/w/_/...` when a real runtime ID is requested.

The app therefore needs two matching fallbacks:

1. Next dev/server rewrite for local development and `tauri dev`.
2. Tauri static asset fallback for packaged desktop builds.

The client then recovers the real ID from the live URL or rewrite query params.

## Current Fix

### 1. Client Param Recovery

File: `src/lib/utils/route-params.ts`

Use `useRouteParams()` instead of `useParams()` under `/w/[id]`.

It resolves real params from:

1. `useParams()` when the route is dynamic in dev.
2. `usePathname()` when Tauri serves a placeholder shell for a real URL.
3. Rewrite query params, e.g. `workspaceId`, `sourceId`, `lessonId`.

Important edge case:

```text
/w/<id>/study/journal
```

`journal` is a static route segment, not a `lessonId`. The helper must not
recover `lessonId = "journal"`.

### 2. Next Dev/Server Rewrites

File: `next.config.ts`

The non-static-export config defines workspace rewrites such as:

```text
/w/:id                     -> /w/_?workspaceId=:id
/w/:id/cards               -> /w/_/cards?workspaceId=:id
/w/:id/read/:sourceId      -> /w/_/read/_?workspaceId=:id&sourceId=:sourceId
/w/:id/study/journal       -> /w/_/study/journal?workspaceId=:id
/w/:id/study/:lessonId     -> /w/_/study/_?workspaceId=:id&lessonId=:lessonId
```

This keeps visible URLs human-readable (`/w/ws_xxx/cards`) while ensuring Next
serves a generated placeholder route.

### 3. Tauri Static Asset Fallback

File: `src-tauri/src/lib.rs`

The custom `tauri://` asset handler tries the requested asset first. If it is a
missing workspace route, it rewrites runtime IDs to `_` and retries:

```text
/w/ws_xxx                 -> /w/_
/w/ws_xxx/cards           -> /w/_/cards
/w/ws_xxx/read/source_1   -> /w/_/read/_
```

The fallback preserves Next segment-cache markers such as `__next.*` and
`$d$...`, and keeps `/study/journal` as a static sibling route.

### 4. Turbopack Root Pinning

File: `next.config.ts`

The config pins:

```ts
turbopack: { root: process.cwd() }
```

This avoids Next/Turbopack selecting a parent directory as the workspace root
when another lockfile exists above the repo. Do not replace this with a local
absolute path.

## Do Not Regress

Do not remove or loosen these pieces independently:

- `dynamicParams = false` in static-exported workspace layouts.
- Placeholder `generateStaticParams()` entries.
- `useRouteParams()` usage under `/w/[id]`.
- Next dev/server workspace rewrites in `next.config.ts`.
- Tauri asset fallback in `src-tauri/src/lib.rs`.
- The `/study/journal` special case.

If one layer is changed, verify both dev and static export paths.

## Verification Checklist

Run targeted checks:

```powershell
npm.cmd run test:run -- src/lib/utils/route-params.test.ts
cargo test --manifest-path src-tauri\Cargo.toml export_fallback_tests
npm.cmd run typecheck
npx eslint next.config.ts src/lib/utils/route-params.ts src/lib/utils/route-params.test.ts scripts/serve-out-repro.mjs
```

Run static export build:

```powershell
npm.cmd run build:export
```

If the build fails while fetching Google Fonts in a restricted environment,
rerun with network access. That failure is not a route regression.

Expected static export route output includes:

```text
/w/_
/w/_/cards
/w/_/quiz
/w/_/map
/w/_/notes
/w/_/research
/w/_/roadmap
/w/_/read/_
/w/_/audio/_
/w/_/study/_
/w/_/study/journal
```

Run the static routing repro:

```powershell
node scripts\serve-out-repro.mjs
node scripts\repro-allroutes.mjs
```

Expected result:

```text
OVERALL: ALL PASS
```

Manual smoke test:

1. Restart the dev app after changing `next.config.ts`.
2. Open dashboard.
3. Create or select a workspace.
4. Confirm the visible URL remains `/w/<workspace-id>`.
5. Confirm the page is not the global 404.
6. Open workspace subroutes: cards, quiz, map, notes, research, roadmap,
   study journal.

## Privacy Note

Do not document local absolute paths in committed files. This routing fix uses
`process.cwd()` and generic route params, not machine-specific paths.
