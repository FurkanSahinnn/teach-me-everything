// Research provider interface — mirrors ChatProvider/EmbedProvider so the
// registry layer can compose them identically (singleton cache + preset
// synthesis + Settings UI projection). A provider's only job is: take a URL,
// return Markdown + metadata. The downstream pipeline (chunker → embed →
// sources/chunks) is shared with PDF/DOCX ingest.
//
// Why not "fetch HTML and let the caller convert": some providers
// (Firecrawl, Jina Reader, Exa) already return Markdown server-side; making
// Markdown the contract means readability stays the only adapter that has to
// DOMParse, and we never pay a double-conversion penalty for cloud providers.

import { ProviderError } from "@/lib/ai/providers/types";

export type ResearchProviderId =
  | "readability"
  | "firecrawl"
  | "exa"
  | "jina-reader"
  | "tavily"
  | "diffbot"
  | "brightdata";

export type ResearchProviderKind = "local" | "cloud";

export type ResearchAuth =
  | { kind: "none" }
  | { kind: "bearer" }
  | { kind: "header"; headerName: string };

export type ResearchCapabilities = {
  /** Provider can render JavaScript-heavy pages (SPAs). */
  jsRender: boolean;
  /** Provider also offers neural/web search alongside content extraction. */
  search: boolean;
  /** Provider extracts content fully client-side (no upstream call). */
  local: boolean;
  /** Provider has a usable free tier without a key. */
  freeTier: boolean;
};

export type ResearchPreset = {
  id: ResearchProviderId;
  label: string;
  kind: ResearchProviderKind;
  /** Cloud providers only — origin used for CSP + (optional) proxy routing. */
  baseUrl?: string;
  auth: ResearchAuth;
  capabilities: ResearchCapabilities;
  docsUrl: string;
};

export type ResearchRequest = {
  url: string;
  /** Cloud providers only; readability ignores. */
  apiKey?: string;
  signal?: AbortSignal;
};

export type ResearchResult = {
  /** Page content as Markdown. Always provided. */
  markdown: string;
  /** Final canonical URL (after redirects when known). */
  url: string;
  /** Best-effort title from <title>, <h1>, or upstream API. */
  title: string;
  /** Best-effort byline / author. */
  author?: string | undefined;
  /** UTF-8 byte size of `markdown`. */
  byteSize: number;
  /** Provider that produced this result. */
  providerId: ResearchProviderId;
  /** Anything else the provider wants to persist on `SourceRecord.meta`. */
  meta?: Record<string, unknown> | undefined;
};

export interface ResearchProvider {
  readonly id: ResearchProviderId;
  readonly capabilities: ResearchCapabilities;
  fetchContent(req: ResearchRequest): Promise<ResearchResult>;
}

export class ResearchError extends ProviderError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message);
    this.name = "ResearchError";
  }
}
