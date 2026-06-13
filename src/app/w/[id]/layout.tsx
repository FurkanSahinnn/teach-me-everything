import { Suspense, type ReactNode } from "react";
import { WorkspaceVaultMount } from "@/components/vault/WorkspaceVaultMount";

// Phase 7.1 — static-export shim for the workspace dynamic segment.
// Pre-renders only the `/w/_/...` placeholder shell. Suspense wraps children
// because the notes route (and other descendants) calls `useSearchParams()`
// for the `?id={noteId}` URL drive — required for `output: 'export'`.
// See memory `project_phase7_plan.md` § 7.1.
//
// Phase 7.4.D — `<WorkspaceVaultMount />` boots the two-way vault
// reconciler for the focused workspace (Tauri-only; no-op on web).
export async function generateStaticParams(): Promise<{ id: string }[]> {
  return [{ id: "_" }];
}

// `output: export` forbids `dynamicParams: true` (must be a static `false`),
// so only the `/w/_/...` shell HTML + RSC payloads are emitted. Workspace ids
// are user-generated at runtime, so BOTH a hard load AND the Next 16 segment
// fetch behind a soft navigation to `/w/<real-id>/...` would 404 — Tauri's
// asset resolver has no SPA catch-all. Two pieces make runtime ids work:
//   1. `serve_export_asset` (src-tauri/src/lib.rs) rewrites `/w/<id>/...`
//      requests onto the emitted `/w/_/...` shell so the asset exists.
//   2. Pages read the real id from `location.pathname` via `useRouteParams`
//      (src/lib/utils/route-params.ts) — `useParams()` only sees the `_`
//      placeholder baked into the shell.
export const dynamicParams = false;

export default function WorkspaceIdLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      {children}
      <WorkspaceVaultMount />
    </Suspense>
  );
}
