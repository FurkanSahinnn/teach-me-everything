import { Suspense, type ReactNode } from "react";
import { WorkspaceVaultMount } from "@/components/vault/WorkspaceVaultMount";

// Phase 7.1 — static-export shim for the workspace dynamic segment.
// Pre-renders `/w/_/...` shells; real workspace id is resolved client-side
// via `useParams` against Dexie. Suspense wraps children because the notes
// route (and other future descendants) calls `useSearchParams()` for the
// `?id={noteId}` URL drive — required for `output: 'export'` to succeed.
// See memory `project_phase7_plan.md` § 7.1.
//
// Phase 7.4.D — `<WorkspaceVaultMount />` boots the two-way vault
// reconciler for the focused workspace (Tauri-only; no-op on web).
export async function generateStaticParams(): Promise<{ id: string }[]> {
  return [{ id: "_" }];
}

// `output: export` forbids `dynamicParams: true` (and it must be a static
// boolean literal), so it is `false`: only the `/w/_/...` shell is emitted.
// TME workspace ids are user-generated at runtime, so the running Tauri app
// reaches `/w/<real-id>/...` via client-side SPA navigation (router.push /
// <Link>), which renders the matched route client-side without a pre-built
// HTML page — the 404 only applies to a hard server load of an unlisted id.
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
