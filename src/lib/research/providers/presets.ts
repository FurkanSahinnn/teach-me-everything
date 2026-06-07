// Research presets — metadata-only registry mirroring PROVIDER_PRESETS +
// EMBED_PRESETS. CSP origin derivation, Settings UI projection, and proxy
// allow-listing all read against this single source of truth.

import type { ResearchPreset, ResearchProviderId } from "./types";

export const RESEARCH_PRESETS: Record<ResearchProviderId, ResearchPreset> = {
  readability: {
    id: "readability",
    label: "Readability (yerel)",
    kind: "local",
    auth: { kind: "none" },
    capabilities: {
      jsRender: false,
      search: false,
      local: true,
      freeTier: true,
    },
    docsUrl: "https://github.com/mozilla/readability",
  },
  firecrawl: {
    id: "firecrawl",
    label: "Firecrawl",
    kind: "cloud",
    baseUrl: "https://api.firecrawl.dev",
    auth: { kind: "bearer" },
    capabilities: {
      jsRender: true,
      search: false,
      local: false,
      freeTier: false,
    },
    docsUrl: "https://docs.firecrawl.dev/",
  },
  exa: {
    id: "exa",
    label: "Exa",
    kind: "cloud",
    baseUrl: "https://api.exa.ai",
    auth: { kind: "header", headerName: "x-api-key" },
    capabilities: {
      jsRender: true,
      search: true,
      local: false,
      freeTier: true,
    },
    docsUrl: "https://docs.exa.ai/",
  },
  "jina-reader": {
    id: "jina-reader",
    label: "Jina Reader",
    kind: "cloud",
    baseUrl: "https://r.jina.ai",
    auth: { kind: "bearer" },
    capabilities: {
      jsRender: true,
      search: false,
      local: false,
      freeTier: true,
    },
    docsUrl: "https://jina.ai/reader/",
  },
  tavily: {
    id: "tavily",
    label: "Tavily",
    kind: "cloud",
    baseUrl: "https://api.tavily.com",
    auth: { kind: "header", headerName: "x-api-key" },
    capabilities: {
      jsRender: true,
      search: true,
      local: false,
      freeTier: true,
    },
    docsUrl: "https://docs.tavily.com/",
  },
  diffbot: {
    id: "diffbot",
    label: "Diffbot",
    kind: "cloud",
    baseUrl: "https://api.diffbot.com",
    auth: { kind: "bearer" },
    capabilities: {
      jsRender: true,
      search: false,
      local: false,
      freeTier: false,
    },
    docsUrl: "https://docs.diffbot.com/reference/extract-article",
  },
  brightdata: {
    id: "brightdata",
    label: "Bright Data",
    kind: "cloud",
    baseUrl: "https://api.brightdata.com",
    auth: { kind: "bearer" },
    capabilities: {
      jsRender: true,
      search: false,
      local: false,
      freeTier: false,
    },
    docsUrl: "https://docs.brightdata.com/api-reference/unlocker",
  },
};

export function getResearchPreset(id: ResearchProviderId): ResearchPreset | undefined {
  return RESEARCH_PRESETS[id];
}

export function listResearchPresets(): ResearchPreset[] {
  return Object.values(RESEARCH_PRESETS);
}
