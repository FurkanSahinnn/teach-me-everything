// Build-time helper that walks the embed + chat preset registries and
// returns a deduplicated set of `${protocol}//${host}` origins for the CSP
// `connect-src` directive. Adding a new cloud preset to either registry
// automatically extends the directive — no next.config edit needed.
//
// CSP source list and proxy allow-list both come from the preset registry
// now: the proxy gates on PROVIDER_TO_FAMILY, the browser gates on this
// function. One source of truth for "where the user can talk to upstream".

// Relative import (not `@/lib/...` alias) because next.config.ts imports
// this file at build time via plain Node — the compiled config doesn't run
// the TS path-alias resolver. Keep all imports here relative.
import { RESEARCH_PRESETS } from "../research/providers/presets";
import { EMBED_PRESETS } from "./providers/embed-presets";
import { isLocalUrl } from "./providers/local-bypass";
import { PROVIDER_PRESETS } from "./providers/presets";

// Origins that aren't preset-derived but must always be present:
//   'self' — route handlers + same-origin fetches
//   api.anthropic.com — chat (Anthropic has no embed preset entry)
//   huggingface.co — Phase 11 lazy install of Piper voice models
//   api.crossref.org — DOI metadata, no preset (free, no key)
//   api.openalex.org — DOI fallback, no preset (free, no key)
//   export.arxiv.org — arXiv metadata, no preset (free, no key)
//   api.search.brave.com — Brave Search "Konu ara" modal (5.5.E); the search
//     surface is separate from the research extractor pipeline, so it lives
//     outside RESEARCH_PRESETS and needs to be seeded explicitly here.
export const SEED_ORIGINS: readonly string[] = [
  "'self'",
  "https://api.anthropic.com",
  "https://huggingface.co",
  "https://api.crossref.org",
  "https://api.openalex.org",
  "https://export.arxiv.org",
  "https://api.search.brave.com",
];

type AnyPreset = { baseUrl?: string; isLocal?: boolean };

function originOf(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    // Malformed baseUrls would crash the build otherwise; CSP must remain
    // load-bearing even if a preset entry is mistyped.
    return null;
  }
}

export function deriveConnectOrigins(): string[] {
  const out = new Set<string>(SEED_ORIGINS);
  const presets: AnyPreset[] = [
    ...Object.values(EMBED_PRESETS),
    ...Object.values(PROVIDER_PRESETS),
    // Research presets contribute the cloud-provider origins (firecrawl,
    // exa, jina-reader, tavily). The readability entry has no baseUrl so
    // it's a no-op in this loop.
    ...Object.values(RESEARCH_PRESETS),
  ];
  for (const p of presets) {
    if (!p) continue;
    if (p.isLocal === true) continue;
    if (typeof p.baseUrl !== "string" || p.baseUrl.length === 0) continue;
    // PROVIDER_PRESETS has no isLocal flag (loopback ollama / lm-studio /
    // llama-cpp entries live there too); URL-based detection is the second
    // gate so loopback never reaches the cloud allow-list.
    if (isLocalUrl(p.baseUrl)) continue;
    const origin = originOf(p.baseUrl);
    if (origin) out.add(origin);
  }
  return [...out];
}
