"use client";

// Phase 7.4.D — Client island that resolves the workspace id (via
// `useRouteParams`, which recovers the real id from the pathname under
// static export) and hands it to `VaultReconcilerProvider`. Lives in the
// workspace-segment layout so the reconciler only runs while the user
// is inside `/w/[id]/*`, and swaps cleanly on workspace change.

import { useRouteParams } from "@/lib/utils/route-params";
import { VaultReconcilerProvider } from "./VaultReconcilerProvider";

export function WorkspaceVaultMount() {
  const params = useRouteParams<{ id?: string }>();
  const id = typeof params?.id === "string" ? params.id : null;
  return <VaultReconcilerProvider workspaceId={id} />;
}
