import type { ReactNode } from "react";

// Phase 7.1 — static-export shim for the podcast dynamic segment. Combined
// with the parent `[id]/layout.tsx` placeholder so Next can pre-render
// `/w/_/audio/_` during `output: 'export'`. Real podcast id is resolved
// client-side from the podcasts repo.
export async function generateStaticParams(): Promise<
  { podcastId: string }[]
> {
  return [{ podcastId: "_" }];
}

// Real podcast ids are user-generated at runtime — accept anything.
export const dynamicParams = true;

export default function AudioPodcastLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
