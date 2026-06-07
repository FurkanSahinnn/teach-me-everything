import type { ReactNode } from "react";

// Phase 7.1 — static-export shim. Provides a placeholder `step` value so
// Next's `output: 'export'` can pre-render this segment's shell; the real
// step is resolved client-side via `useParams` against the wizard store.
// Web/dev branch is unaffected — Next ignores `generateStaticParams` when
// not exporting. See memory `project_phase7_plan.md` § 7.1.
export async function generateStaticParams(): Promise<{ step: string }[]> {
  return [{ step: "_" }];
}

// Wizard step is resolved client-side from the wizard store; accept any
// segment value so direct URL navigation works in dev + static export.
export const dynamicParams = true;

export default function SetupStepLayout({ children }: { children: ReactNode }) {
  return children;
}
