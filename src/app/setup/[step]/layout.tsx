import type { ReactNode } from "react";

// Setup is a fixed 4-step wizard navigated via real /setup/1../setup/4 URLs
// (router.push(`/setup/${to}`), <Link href="/setup/1">). Enumerating the four
// steps lets the Tauri static export (`output: export`) pre-render each step's
// shell while dev navigation keeps working. `dynamicParams` MUST be a static
// boolean literal (Next/Turbopack rejects a computed value) and `output:
// export` forbids `true`, so it is `false` — unknown segments 404, which the
// page already intends via notFound().
export async function generateStaticParams(): Promise<{ step: string }[]> {
  return [{ step: "1" }, { step: "2" }, { step: "3" }, { step: "4" }];
}

export const dynamicParams = false;

export default function SetupStepLayout({ children }: { children: ReactNode }) {
  return children;
}
