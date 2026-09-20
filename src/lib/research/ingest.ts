// Research ingest orchestrator — single entry point that turns a user-pasted
// URL into a ready-to-query `SourceRecord` + `ChunkRecord` rows.
//
// Pipeline:
//   classifyUrl(input)
//     ├─ "doi"     → fetchDoi(doi)
//     ├─ "youtube" → fetchYoutubeTranscript(videoId)
//     ├─ "arxiv"   → fetchArxiv(arxivId)
//     └─ "web"     → getResearchProvider(prefs).fetchContent(url)
//   → createSource({ workspaceId, type, title, url, ingestStatus: "parsing" })
//   → chunkPages([{ page: 1, text: markdown }])
//   → bulkAddChunks(chunks)
//   → setIngestStatus("ready")

import { bulkAddChunks } from "@/lib/db/chunks";
import {
  createSource,
  findSourceByUrl,
  setIngestStatus,
} from "@/lib/db/sources";
import type { SourceRecord, SourceType } from "@/lib/db/types";
import { chunkPages } from "@/lib/ingest/chunker";
import { fetchArxiv } from "./arxiv-fetch";
import { fetchDoi } from "./doi-fetch";
import { getResearchProvider } from "./providers/registry";
import { ResearchError, type ResearchProviderId, type ResearchResult } from "./providers/types";
import { classifyUrl, type ClassifiedUrl } from "./url-classifier";
import { fetchYoutubeTranscript } from "./youtube-fetch";

export type ResearchIngestInput = {
  workspaceId: string;
  /** The user's raw input — URL, DOI, or arXiv id. */
  rawInput: string;
  /** Which web provider to use for the "web" branch. Default: readability. */
  webProvider?: ResearchProviderId;
  /** API key for cloud providers (BYOK). Ignored for readability. */
  apiKey?: string;
  signal?: AbortSignal;
};

export type ResearchIngestOutput = {
  source: SourceRecord;
  chunkCount: number;
  byteSize: number;
};

export type ResearchFetchOptions = {
  webProvider?: ResearchProviderId;
  apiKey?: string;
  signal?: AbortSignal;
};

export type ResearchFetchOutput = {
  result: ResearchResult;
  sourceType: SourceType;
  displayUrl: string;
};

/**
 * Fetch step on its own, so re-chunking an existing URL source can re-pull the
 * same markdown without re-running the create-source half of the pipeline.
 */
export async function fetchResearchContent(
  classified: Exclude<ClassifiedUrl, { kind: "invalid" }>,
  opts: ResearchFetchOptions = {},
): Promise<ResearchFetchOutput> {
  // Built once so each branch picks it up without re-handling the optional.
  const fetchOpts: { signal?: AbortSignal } = {};
  if (opts.signal !== undefined) fetchOpts.signal = opts.signal;

  switch (classified.kind) {
    case "doi": {
      const result = await fetchDoi(classified.doi, fetchOpts);
      return { result, sourceType: "doi", displayUrl: result.url };
    }
    case "youtube": {
      const result = await fetchYoutubeTranscript(classified.videoId, fetchOpts);
      return { result, sourceType: "youtube", displayUrl: result.url };
    }
    case "arxiv": {
      const result = await fetchArxiv(classified.arxivId, fetchOpts);
      return { result, sourceType: "arxiv", displayUrl: result.url };
    }
    case "web": {
      const providerId = opts.webProvider ?? "readability";
      const provider = getResearchProvider(providerId);
      const req: {
        url: string;
        apiKey?: string;
        signal?: AbortSignal;
      } = { url: classified.url };
      if (opts.apiKey !== undefined) req.apiKey = opts.apiKey;
      if (opts.signal !== undefined) req.signal = opts.signal;
      const result = await provider.fetchContent(req);
      return { result, sourceType: "url", displayUrl: result.url };
    }
  }
}

export async function ingestResearchUrl(
  input: ResearchIngestInput,
): Promise<ResearchIngestOutput> {
  const classified = classifyUrl(input.rawInput);
  if (classified.kind === "invalid") {
    throw new ResearchError(
      400,
      `invalid_input_${classified.reason}`,
      `Invalid input: ${classified.reason}`,
    );
  }

  // Idempotency: if the workspace already has a source pointing at this
  // URL, short-circuit and return the existing record. Stops "Add as
  // sources" double-clicks from creating duplicate rows. We match on the
  // raw user input — callers like SearchSourcesModal feed the same URL
  // string verbatim on every retry, so an exact match is enough. Edge
  // cases (canonical-URL drift, trailing slashes) fall through to
  // contentHash-based dedupe inside the provider layer.
  const existing = await findSourceByUrl(input.workspaceId, input.rawInput);
  if (existing) {
    return {
      source: existing,
      // The existing record already has its chunks persisted; callers
      // that need the count can re-query. We return 0 here rather than
      // a stale guess so it's clear no new chunks were added.
      chunkCount: 0,
      byteSize: existing.byteSize ?? 0,
    };
  }

  // Step 1: fetch content from the right channel.
  const fetchOptions: ResearchFetchOptions = {};
  if (input.webProvider !== undefined) fetchOptions.webProvider = input.webProvider;
  if (input.apiKey !== undefined) fetchOptions.apiKey = input.apiKey;
  if (input.signal !== undefined) fetchOptions.signal = input.signal;
  const { result, sourceType, displayUrl } = await fetchResearchContent(
    classified,
    fetchOptions,
  );

  // Idempotency, second pass: the early check matched the RAW user input, but
  // the row we are about to create stores `url: displayUrl` (the resolved
  // canonical). Re-adding `youtu.be/X` after `youtube.com/watch?v=X` (or a
  // url with tracking params) would slip past the raw-input check and create
  // a duplicate. Match on what actually gets persisted before inserting.
  const existingCanonical = await findSourceByUrl(input.workspaceId, displayUrl);
  if (existingCanonical) {
    return {
      source: existingCanonical,
      chunkCount: 0,
      byteSize: existingCanonical.byteSize ?? 0,
    };
  }

  // Step 2: create the SourceRecord up front so the UI can show "parsing".
  const sourceInput: Parameters<typeof createSource>[0] = {
    workspaceId: input.workspaceId,
    type: sourceType,
    title: result.title,
    url: displayUrl,
    byteSize: result.byteSize,
    ingestStatus: "parsing",
    meta: {
      ...(result.meta ?? {}),
      researchProvider: result.providerId,
    },
  };
  if (result.author !== undefined) sourceInput.author = result.author;
  const source = await createSource(sourceInput);

  // Step 3: chunk + persist. The chunker is page-oriented (built for PDFs),
  // so we feed the whole markdown as a single "page 1". Markdown headings
  // still get picked up by the heading-pattern detector inside chunkPages.
  try {
    const chunked = chunkPages({
      pages: [{ page: 1, text: result.markdown }],
      format: "markdown",
    });
    if (chunked.length === 0) {
      // Chunker returning nothing means the body collapsed to whitespace —
      // treat as upstream error so the UI shows a real message.
      throw new ResearchError(
        422,
        "empty_chunks",
        "Content extracted but produced no chunks",
      );
    }
    const records = chunked.map((c) => ({
      sourceId: source.id,
      workspaceId: input.workspaceId,
      index: c.index,
      text: c.text,
      tokenCount: c.tokenCount,
      page: c.page,
      section: c.section,
      headings: c.headings,
    }));
    await bulkAddChunks(records);
    await setIngestStatus(source.id, "ready");
    return {
      source: { ...source, ingestStatus: "ready" },
      chunkCount: chunked.length,
      byteSize: result.byteSize,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setIngestStatus(source.id, "error", msg);
    throw err;
  }
}
