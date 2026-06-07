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

// Next 16 + App Router default behaviour with a `generateStaticParams`
// returning a fixed list is to 404 unlisted ids ("strict" mode). TME ids
// are user-generated at runtime in Dexie — we MUST accept any id here and
// let the client resolve via `useParams`. Without this, the dev server and
// the Tauri static-export bundle both 404 on `/w/<real-uuid>/...`.
export const dynamicParams = true;

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
