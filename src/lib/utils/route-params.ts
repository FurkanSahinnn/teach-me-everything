"use client";

// Static-export route-param resolver.
//
// Under `output: 'export'` the dynamic `/w/[id]/...` segments are pre-rendered
// only as the `/w/_/...` placeholder shell (generateStaticParams → [{id:"_"}],
// dynamicParams=false). When the Tauri asset-resolver serves that shell for a
// real runtime URL like `/w/<workspace-id>/cards`, Next's `useParams()` returns
// the BUILD-TIME placeholder (`id === "_"`), not the real id — so the page
// would look up workspace "_", find nothing, and call `notFound()`.
//
// This helper recovers the real param values from `usePathname()` (which always
// reflects the live browser URL) whenever `useParams()` yields the `_`
// placeholder or is missing. In `npm run dev` / non-export builds `useParams()`
// already returns real values, so this is a transparent pass-through there.
//
// See memory `feedback_static_export_dynamic_route_404.md` and the Rust
// asset-resolver fallback in `src-tauri/src/lib.rs`.

import { useParams, usePathname, useSearchParams } from "next/navigation";

const PLACEHOLDER = "_";
const WORKSPACE_ID_PARAM = "workspaceId";

// Maps the static parent segment to the dynamic child param name it precedes,
// e.g. `/w/<id>/read/<sourceId>` → after "read" comes the sourceId.
const DYNAMIC_CHILD: Record<string, string> = {
  audio: "podcastId",
  read: "sourceId",
  study: "lessonId",
  roadmap: "roadmapId",
};

function childParamFor(parent: string | undefined, child: string | undefined) {
  if (parent === "study" && child === "journal") return undefined;
  return parent ? DYNAMIC_CHILD[parent] : undefined;
}

function searchValue(
  search: Pick<URLSearchParams, "get"> | string | undefined,
  key: string,
): string | undefined {
  if (!search) return undefined;
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const value = params.get(key);
  return value && value.length > 0 ? value : undefined;
}

function firstString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function needsRecovery(value: string | undefined): boolean {
  return value === undefined || value === PLACEHOLDER || value === "";
}

/**
 * Pure resolver — overlays real path-derived values on top of `useParams()`
 * output wherever the param is the export placeholder. Exported for testing.
 */
export function resolveRouteParams(
  params: Record<string, string | string[] | undefined>,
  pathname: string,
  search?: Pick<URLSearchParams, "get"> | string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const v = firstString(value);
    if (v !== undefined) out[key] = v;
  }

  const segs = pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);

  if (segs[0] === "w") {
    if (needsRecovery(out.id)) {
      const pathId = segs[1] && segs[1] !== PLACEHOLDER ? segs[1] : undefined;
      const queryId = searchValue(search, WORKSPACE_ID_PARAM);
      out.id = pathId ?? queryId ?? out.id ?? segs[1] ?? PLACEHOLDER;
    }
    const parent = segs[2];
    const childParam = childParamFor(parent, segs[3]);
    if (childParam && needsRecovery(out[childParam]) && segs[3]) {
      const pathChild =
        segs[3] && segs[3] !== PLACEHOLDER ? segs[3] : undefined;
      const queryChild = searchValue(search, childParam);
      out[childParam] = pathChild ?? queryChild ?? out[childParam] ?? segs[3];
    }
  } else if (segs[0] === "setup") {
    if (needsRecovery(out.step) && segs[1]) out.step = segs[1];
  }

  return out;
}

/**
 * Drop-in replacement for `useParams<T>()` that survives static-export's
 * placeholder-shell serving. Use this anywhere a page reads a dynamic route
 * param under `/w/[id]/...`.
 */
export function useRouteParams<
  T extends Record<string, string> = Record<string, string>,
>(): T {
  const params = useParams();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return resolveRouteParams(params, pathname, searchParams) as T;
}
