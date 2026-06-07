import type { ReactNode } from "react";

// Phase 7.1 — static-export shim for the nested lesson dynamic segment.
// Combined with the parent `[id]/layout.tsx` placeholder so Next can
// pre-render `/w/_/study/_` during `output: 'export'`. Real lesson id is
// resolved client-side from the study store.
export async function generateStaticParams(): Promise<
  { lessonId: string }[]
> {
  return [{ lessonId: "_" }];
}

// `output: export` requires a static `false`; the running app reaches real
// lesson ids via client-side SPA navigation.
export const dynamicParams = false;

export default function StudyLessonLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
