import { Suspense, type ReactNode } from "react";

// Phase 7.1 — static-export shim for the reader dynamic segment. Combined
// with the parent `[id]/layout.tsx` placeholder so Next can pre-render
// `/w/_/read/_` during `output: 'export'`. Real source id is resolved
// client-side from the sources repo. Suspense wraps the page because the
// reader calls `useSearchParams()` to drive the highlight flyout — without
// the boundary, `output: 'export'` errors with the missing-suspense bailout.
export async function generateStaticParams(): Promise<
  { sourceId: string }[]
> {
  return [{ sourceId: "_" }];
}

// See parent layout — accept any runtime id, client resolves via useParams.
export const dynamicParams = true;

export default function ReadSourceLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
