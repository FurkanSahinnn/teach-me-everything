// DOI fetcher — free, no-key channel via Crossref's REST API.
// API: https://api.crossref.org/works/{doi}
// Returns Markdown built from title + abstract + author list + DOI link.
// When the work advertises an open-access PDF, we surface the URL on
// `pdfUrl` so the caller can route it through the PDF ingest pipeline
// instead of (or alongside) the metadata-only path.

import { ResearchError } from "./providers/types";
import type { ResearchResult } from "./providers/types";

const CROSSREF_API = "https://api.crossref.org/works";

type CrossrefAuthor = { given?: string; family?: string; name?: string };
type CrossrefLink = { URL?: string; "content-type"?: string };

type CrossrefMessage = {
  title?: string[];
  abstract?: string;
  author?: CrossrefAuthor[];
  URL?: string;
  type?: string;
  publisher?: string;
  "container-title"?: string[];
  link?: CrossrefLink[];
};

type CrossrefResponse = {
  status?: string;
  message?: CrossrefMessage;
};

export type DoiFetchResult = ResearchResult & {
  /** When set, the work has an open-access PDF; caller can fork to PDF ingest. */
  pdfUrl?: string;
};

export async function fetchDoi(
  doi: string,
  opts: { signal?: AbortSignal } = {},
): Promise<DoiFetchResult> {
  const endpoint = `${CROSSREF_API}/${encodeURIComponent(doi)}`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        // Crossref asks polite clients to identify themselves so they can
        // promote us to the polite pool. Anonymous fetch still works.
        "User-Agent": "teach-me-everything/0.1 (https://github.com)",
      },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ResearchError(0, "fetch_failed", `Crossref unreachable: ${msg}`);
  }
  if (!res.ok) {
    throw new ResearchError(
      res.status,
      "upstream_error",
      `Crossref returned ${res.status}`,
    );
  }
  const data = (await res.json()) as CrossrefResponse;
  const msg = data.message;
  if (!msg) {
    throw new ResearchError(422, "empty_content", "Crossref returned no message body");
  }

  const title =
    Array.isArray(msg.title) && msg.title[0] ? msg.title[0] : `DOI ${doi}`;
  const authors = (msg.author ?? [])
    .map((a) => {
      if (a.name) return a.name;
      return [a.given, a.family].filter(Boolean).join(" ");
    })
    .filter((s) => s.length > 0);
  const abstractRaw = msg.abstract ?? "";
  // Crossref abstracts are JATS XML — strip tags for a readable Markdown
  // body. We don't try to preserve formatting because JATS doesn't map
  // cleanly to Markdown and the body is fed to the chunker anyway.
  const abstract = abstractRaw
    .replace(/<jats:[^>]+>|<\/jats:[^>]+>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const pdfLink = (msg.link ?? []).find(
    (l) =>
      typeof l.URL === "string" &&
      (l["content-type"] === "application/pdf" ||
        /\.pdf(\?|$)/i.test(l.URL ?? "")),
  );

  const journal =
    Array.isArray(msg["container-title"]) && msg["container-title"][0]
      ? msg["container-title"][0]
      : undefined;

  const lines: string[] = [`# ${title}`, ""];
  if (authors.length > 0) lines.push(`**Authors:** ${authors.join(", ")}`, "");
  if (journal) lines.push(`**Journal:** ${journal}`, "");
  if (msg.publisher) lines.push(`**Publisher:** ${msg.publisher}`, "");
  lines.push(`**DOI:** [${doi}](https://doi.org/${doi})`, "");
  if (abstract.length > 0) {
    lines.push("## Abstract", "", abstract, "");
  } else {
    lines.push(
      "_No abstract available via Crossref. Open the DOI to read the full text._",
      "",
    );
  }
  const markdown = lines.join("\n").trim();

  const result: DoiFetchResult = {
    markdown,
    url: msg.URL ?? `https://doi.org/${doi}`,
    title,
    author: authors.length > 0 ? authors.join(", ") : undefined,
    byteSize: new Blob([markdown]).size,
    providerId: "readability",
    meta: {
      extractor: "crossref",
      doi,
      type: msg.type,
      journal,
      hasAbstract: abstract.length > 0,
    },
  };
  if (pdfLink?.URL) result.pdfUrl = pdfLink.URL;
  return result;
}
