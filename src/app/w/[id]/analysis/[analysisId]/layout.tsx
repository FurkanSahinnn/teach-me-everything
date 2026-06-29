import type { ReactNode } from "react";

// Static-export shim for the analysis-detail dynamic segment (mirrors the
// roadmap/[roadmapId] + read/[sourceId] `_` placeholders). Pre-renders
// `/w/_/analysis/_` during `output: export`; the real analysis id is resolved
// client-side from the articleAnalyses repo (the page reads
// `analysisId === "_" ? undefined`).
//
// `output: export` requires a static `dynamicParams` literal and forbids
// `true`, so it is `false` — the running Tauri app reaches real analysis ids
// via client-side SPA navigation (router.push / <Link>).
export async function generateStaticParams(): Promise<{ analysisId: string }[]> {
  return [{ analysisId: "_" }];
}

export const dynamicParams = false;

export default function AnalysisIdLayout({ children }: { children: ReactNode }) {
  return children;
}
