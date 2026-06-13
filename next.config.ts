import type { NextConfig } from "next";

import { deriveConnectOrigins } from "./src/lib/ai/csp-origins";

const TURBOPACK_ROOT = process.cwd();

function workspaceDevRewrites() {
  return [
    {
      source: "/w/:id/audio/:podcastId",
      destination: "/w/_/audio/_?workspaceId=:id&podcastId=:podcastId",
    },
    {
      source: "/w/:id/read/:sourceId",
      destination: "/w/_/read/_?workspaceId=:id&sourceId=:sourceId",
    },
    {
      source: "/w/:id/roadmap/:roadmapId",
      destination: "/w/_/roadmap/_?workspaceId=:id&roadmapId=:roadmapId",
    },
    {
      source: "/w/:id/study/journal",
      destination: "/w/_/study/journal?workspaceId=:id",
    },
    {
      source: "/w/:id/study/:lessonId",
      destination: "/w/_/study/_?workspaceId=:id&lessonId=:lessonId",
    },
    {
      source: "/w/:id/:path*",
      destination: "/w/_/:path*?workspaceId=:id",
    },
    {
      source: "/w/:id",
      destination: "/w/_?workspaceId=:id",
    },
  ];
}

// Phase 7.1 — Tauri static export mode toggle.
// `NEXT_OUTPUT_EXPORT=true npm run build` (or via npm script `build:export`)
// switches the build to a fully static bundle suitable for Tauri's webview.
// `pageExtensions: ['tsx','jsx']` causes Next to ignore every `route.ts` —
// the LLM proxy API routes under app/api/ai/* are out-of-scope for static
// export (they migrate to client-side @tauri-apps/plugin-http in Phase 7.2).
// `headers()` is incompatible with `output: 'export'` and is omitted in
// export mode; CSP is enforced via Tauri's tauri.conf.json security
// section instead. Web/dev branch is unchanged so `npm run dev` keeps
// working as the fallback documented in memory `project_phase7_plan.md`.
const IS_STATIC_EXPORT = process.env.NEXT_OUTPUT_EXPORT === "true";

function buildHeaders() {
  // CSP `connect-src` is computed at build time from the embed + chat preset
  // registries. Adding a cloud preset to src/lib/ai/providers/{embed-presets,
  // presets}.ts auto-extends the directive — no next.config edit needed.
  // Seeds (anthropic / huggingface / 'self' / research helpers) are non-preset
  // and stay hard-coded inside deriveConnectOrigins.
  const CONNECT_ORIGINS = deriveConnectOrigins();

  // Local + self-hosted endpoints. Loopback covers Ollama / LM Studio /
  // llama.cpp running on the same machine; *.local handles mDNS hostnames
  // (mac-studio.local, etc). Users running an Ollama box on a raw LAN IP
  // (192.168.1.5, 10.0.0.5, …) must add their host explicitly here — the
  // CSP source-expression grammar does not support IP wildcards (no
  // "http://192.168.*"), and we deliberately do not open `http:` blanket
  // to keep an outbound-leak audit small. See docs/PROVIDERS_LOCAL.md.
  //
  // IPv6 loopback `[::1]` is intentionally omitted — CSP3's <host-source>
  // grammar does not formally include IPv6 literals, and browsers reject
  // `[::1]:*` (the wildcard port + bracket combination). Modern OSes resolve
  // `localhost` to both 127.0.0.1 and ::1, so the IPv4 entry covers both.
  const LOCAL_ORIGINS = [
    "http://localhost:*",
    "http://127.0.0.1:*",
    "http://*.local:*",
    "https://localhost:*",
    "https://127.0.0.1:*",
    "https://*.local:*",
  ];

  // 'unsafe-inline' on script-src is required for Next 16 hydration bootstrap;
  // switch to a per-request nonce in Phase 5 once the harness is ready.
  // 'unsafe-eval' kept until pdfjs-dist drops its eval path.
  const CSP_DIRECTIVES = [
    "default-src 'self'",
    `connect-src ${[...CONNECT_ORIGINS, ...LOCAL_ORIGINS].join(" ")}`,
    "img-src 'self' data: blob:",
    "media-src 'self' blob: data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "worker-src 'self' blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ];

  return [
    {
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: CSP_DIRECTIVES.join("; ") },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
      ],
    },
  ];
}

const nextConfig: NextConfig = IS_STATIC_EXPORT
  ? {
      turbopack: { root: TURBOPACK_ROOT },
      output: "export",
      images: { unoptimized: true },
      trailingSlash: true,
      // Excludes app/api/**/route.ts from the static-export build.
      // Phase 7.2 migrates those LLM proxy endpoints to client-side
      // @tauri-apps/plugin-http calls (no CORS, no fetch limit).
      pageExtensions: ["tsx", "jsx"],
      // Static export does not run middleware; relax type-check that
      // would otherwise fail on dynamic catch-alls without params.
      typescript: { ignoreBuildErrors: false },
    }
  : {
      turbopack: { root: TURBOPACK_ROOT },
      async rewrites() {
        return {
          beforeFiles: workspaceDevRewrites(),
        };
      },
      async headers() {
        return buildHeaders();
      },
    };

export default nextConfig;
