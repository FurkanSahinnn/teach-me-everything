"use client";

// Phase 7.4.D — Client island that resolves the workspace id from
// `useParams` and hands it to `VaultReconcilerProvider`. Lives in the
// workspace-segment layout so the reconciler only runs while the user
// is inside `/w/[id]/*`, and swaps cleanly on workspace change.

import { useParams } from "next/navigation";
import { VaultReconcilerProvider } from "./VaultReconcilerProvider";

export function WorkspaceVaultMount() {
  const params = useParams<{ id?: string }>();
  const id = typeof params?.id === "string" ? params.id : null;
  return <VaultReconcilerProvider workspaceId={id} />;
}
