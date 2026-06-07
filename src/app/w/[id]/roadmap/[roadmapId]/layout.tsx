import type { ReactNode } from "react";

// Static-export shim for the roadmap-graph dynamic segment (mirrors the
// read/study/audio `_` placeholders). Pre-renders `/w/_/roadmap/_` during
// `output: export`; the real roadmap id is resolved client-side from the
// roadmaps repo (the page reads `roadmapId === "_" ? undefined`).
//
// `output: export` requires a static `dynamicParams` literal and forbids
// `true`, so it is `false` — the running Tauri app reaches real roadmap ids
// via client-side SPA navigation (router.push / <Link>), which renders the
// matched route client-side without a pre-built HTML page.
export async function generateStaticParams(): Promise<{ roadmapId: string }[]> {
  return [{ roadmapId: "_" }];
}

export const dynamicParams = false;

export default function RoadmapIdLayout({ children }: { children: ReactNode }) {
  return children;
}
