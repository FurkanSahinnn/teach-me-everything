// Research provider registry — singleton cache + per-id construction.
// Mirrors the chat/embed registry shape so adding a new provider only needs
// (a) a preset entry, (b) an adapter class, (c) a switch case here.

import { BrightDataResearchProvider } from "./brightdata";
import { DiffbotResearchProvider } from "./diffbot";
import { ExaResearchProvider } from "./exa";
import { FirecrawlResearchProvider } from "./firecrawl";
import { JinaReaderResearchProvider } from "./jina-reader";
import { ReadabilityResearchProvider } from "./readability";
import { TavilyResearchProvider } from "./tavily";
import {
  ResearchError,
  type ResearchProvider,
  type ResearchProviderId,
} from "./types";

const cache = new Map<ResearchProviderId, ResearchProvider>();

function construct(id: ResearchProviderId): ResearchProvider {
  switch (id) {
    case "readability":
      return new ReadabilityResearchProvider();
    case "firecrawl":
      return new FirecrawlResearchProvider();
    case "exa":
      return new ExaResearchProvider();
    case "jina-reader":
      return new JinaReaderResearchProvider();
    case "tavily":
      return new TavilyResearchProvider();
    case "diffbot":
      return new DiffbotResearchProvider();
    case "brightdata":
      return new BrightDataResearchProvider();
    default: {
      // Exhaustiveness — TS will yell here if a new id is added without a case.
      const _never: never = id;
      throw new ResearchError(
        404,
        "unknown_provider",
        `Unknown research provider: ${String(_never)}`,
      );
    }
  }
}

export function getResearchProvider(id: ResearchProviderId): ResearchProvider {
  let p = cache.get(id);
  if (p) return p;
  p = construct(id);
  cache.set(id, p);
  return p;
}

export function listResearchProviderIds(): ResearchProviderId[] {
  return [
    "readability",
    "firecrawl",
    "exa",
    "jina-reader",
    "tavily",
    "diffbot",
    "brightdata",
  ];
}
