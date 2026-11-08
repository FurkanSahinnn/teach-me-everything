# Static Export Workspace Routing

How runtime workspace routes (`/w/<id>/...`) work under the Tauri static export. This is unrelated to updater signing keys: those only verify update artifacts and never affect routing or Dexie data.

## Problem

The desktop app ships `next build` with `output: "export"` (`npm run build:export`, which sets `NEXT_OUTPUT_EXPORT=true`; see `next.config.ts`). Workspace, source, lesson, podcast, roadmap and analysis ids are created at runtime, so they cannot be pre-rendered. Only placeholder shells are emitted under `/w/_/...`:

- `src/app/w/[id]/layout.tsx`: `generateStaticParams` returns `[{ id: "_" }]` and `dynamicParams = false`.
- Each two-level child has its own `[childId]/layout.tsx` returning `[{ <childId>: "_" }]` (see the list below).

A request for `/w/ws_abc/cards/` has no file in the export and the asset resolver would answer with the global 404. Four layers close the gap.

## 1. Dev and server rewrites (`next.config.ts`)

In non-export builds `workspaceDevRewrites()` is returned from `rewrites()` as `beforeFiles` rules. Order matters, specific rules first:

```text
/w/:id/audio/:podcastId     -> /w/_/audio/_?workspaceId=:id&podcastId=:podcastId
/w/:id/read/:sourceId       -> /w/_/read/_?workspaceId=:id&sourceId=:sourceId
/w/:id/roadmap/:roadmapId   -> /w/_/roadmap/_?workspaceId=:id&roadmapId=:roadmapId
/w/:id/analysis/:analysisId -> /w/_/analysis/_?workspaceId=:id&analysisId=:analysisId
/w/:id/study/journal        -> /w/_/study/journal?workspaceId=:id
/w/:id/study/:lessonId      -> /w/_/study/_?workspaceId=:id&lessonId=:lessonId
/w/:id/:path*               -> /w/_/:path*?workspaceId=:id      (catch-all)
/w/:id                      -> /w/_?workspaceId=:id
```

The export branch of the config has no rewrites; static export cannot run them.

## 2. Packaged-app asset fallback (`src-tauri/src/lib.rs`)

`run()` replaces the built-in `tauri://` handler with `serve_export_asset`. It asks `asset_resolver().get(path)` first; only on a miss does it call `export_shell_fallback(path)` and retry with the result. Existing assets are served unchanged.

`export_shell_fallback` algorithm:

1. Split the path on `/`. If it is not `/w/<something>/...` return `None`.
2. Replace segment 2 (workspace id) with `_` unless it is already `_` or empty, or is a tree marker (`__next*` or `$d$*`).
3. Scan from segment 3. When a segment is in `DYN_PARENTS` (`audio`, `read`, `study`, `roadmap`, `analysis`) the next segment is a runtime id and becomes `_`. Exceptions: empty, already `_`, a tree marker, or `study/journal` (a static route).
4. Stop at the first tree marker. The Next 16 RSC segment-tree suffix (`__next.w/$d$id/...`) is keyed on placeholder tokens, identical for all ids, and must pass through byte-for-byte.
5. Return `Some(joined)` only if something changed.

Leaf routes (`cards`, `chat`, `notes`, ...) need only step 2. Unit tests live next to the function in `lib.rs`.

## 3. Client recovery (`src/lib/utils/route-params.ts`)

The shell renders with `useParams()` returning `"_"`. `useRouteParams()` wraps `useParams`, `usePathname` and `useSearchParams` and delegates to the pure `resolveRouteParams(params, pathname, search)`:

- If `id` is missing or `_`, take it from the path (`segs[1]`), else from the `workspaceId` query param (set by the dev rewrites).
- The child param name comes from `DYNAMIC_CHILD` (`audio: podcastId`, `read: sourceId`, `study: lessonId`, `roadmap: roadmapId`, `analysis: analysisId`), looked up by the parent segment. `study/journal` is excluded.
- Same recovery for `/setup/<step>`.

Rule: never use bare `useParams()` under `/w/[id]`; always `useRouteParams()`. Bare `useParams()` returns `"_"` in the export, the workspace lookup fails and the page calls `notFound()`.

## 4. Child layouts returning `"_"`

Each has `generateStaticParams` returning the placeholder and `dynamicParams = false` (a static literal is required by `output: export`):

- `src/app/w/[id]/read/[sourceId]/layout.tsx`
- `src/app/w/[id]/study/[lessonId]/layout.tsx`
- `src/app/w/[id]/audio/[podcastId]/layout.tsx`
- `src/app/w/[id]/roadmap/[roadmapId]/layout.tsx`
- `src/app/w/[id]/analysis/[analysisId]/layout.tsx`

`src/app/setup/[step]/layout.tsx` is different: it enumerates the real steps `1` to `4`.

## Checklist: adding a `/w/[id]` route

Leaf route (for example `/w/[id]/foo`): add `src/app/w/[id]/foo/page.tsx` only. The catch-all dev rewrite and step 2 of the Rust fallback already cover it. Read the id with `useRouteParams()`.

Two-level child route (`/w/[id]/foo/[fooId]`), all four registrations are required or the detail page 404s:

1. `next.config.ts`: add a `/w/:id/foo/:fooId` rule to `workspaceDevRewrites()` before the catch-all.
2. `src/lib/utils/route-params.ts`: add `foo: "fooId"` to `DYNAMIC_CHILD`.
3. `src-tauri/src/lib.rs`: add `"foo"` to `DYN_PARENTS` in `export_shell_fallback` (update the array length) and extend its tests.
4. `src/app/w/[id]/foo/[fooId]/layout.tsx`: `generateStaticParams` returning `[{ fooId: "_" }]` and `export const dynamicParams = false`.

If the parent has a static sibling child (like `study/journal`), exclude it in all three places (rewrite order, `childParamFor`, the Rust check). Pages treat `fooId === "_"` as "no id".

## Reproduce and verify

Both scripts are throwaway checks; they use Playwright and a fixed port.

1. `npm run build:export` (produces `out/`).
2. `node scripts/serve-out-repro.mjs`: serves `out/` on `http://localhost:4599`, mimicking Tauri (exact file, then `dir/index.html`, else 404 with no SPA fallback). It carries a JavaScript copy of the rewrite in `/w/` paths and logs `REWRITE`, `200`, `404` lines.
3. In another shell, `node scripts/repro-allroutes.mjs`: injects workspace `repro-ws-1` into IndexedDB (`tme`), hard-loads home, cards, quiz, map, notes, research, roadmap and study/journal, checks there is no "Sayfa bulunamadı" and the workspace name renders, then checks a soft navigation home to cards keeps the page alive. Exits 0 on all pass.

The real fallback is the Rust one; the repro server only approximates it. For a final check run the packaged app (`npm run tauri:build`) and open a workspace, a source and a lesson.
