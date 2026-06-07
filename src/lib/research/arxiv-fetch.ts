// arXiv fetcher — free, no-key channel via the export.arxiv.org Atom API.
// API: https://export.arxiv.org/api/query?id_list={id}
// Returns Markdown built from title + abstract + authors + PDF link.
// Caller can fork to the PDF ingest pipeline using the surfaced `pdfUrl`.

import { ResearchError } from "./providers/types";
import type { ResearchResult } from "./providers/types";

const ARXIV_API = "https://export.arxiv.org/api/query";

export type ArxivFetchResult = ResearchResult & {
  pdfUrl?: string;
};

/**
 * Pure parser exported for tests. Walks the Atom XML response and extracts
 * the first <entry>. No DOMParser dependency — arXiv's Atom is plain enough
 * that regex + targeted slicing is more portable across Node + jsdom.
 */
export function parseArxivAtom(
  xml: string,
  arxivId: string,
): {
  title: string;
  abstract: string;
  authors: string[];
  publishedYear?: string;
  pdfUrl?: string;
  canonicalUrl: string;
} {
  const entry = sliceTag(xml, "entry") ?? xml;
  const title = decodeXml(sliceTag(entry, "title") ?? `arXiv ${arxivId}`)
    .replace(/\s+/g, " ")
    .trim();
  const abstract = decodeXml(sliceTag(entry, "summary") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const authors: string[] = [];
  const authorRegex = /<author>([\s\S]*?)<\/author>/g;
  let m: RegExpExecArray | null;
  while ((m = authorRegex.exec(entry)) !== null) {
    const inner = m[1];
    if (!inner) continue;
    const nameMatch = /<name>([\s\S]*?)<\/name>/.exec(inner);
    if (nameMatch && nameMatch[1]) authors.push(decodeXml(nameMatch[1]).trim());
  }
  const publishedMatch = /<published>(\d{4})/.exec(entry);
  const publishedYear = publishedMatch?.[1];

  // Atom <link rel="related" type="application/pdf" href="...">
  let pdfUrl: string | undefined;
  const linkRegex = /<link\b([^>]*)\/?\s*>/g;
  let lm: RegExpExecArray | null;
  while ((lm = linkRegex.exec(entry)) !== null) {
    const attrs = lm[1] ?? "";
    const isPdf =
      /\btype="application\/pdf"/.test(attrs) || /\.pdf(?:")/i.test(attrs);
    const hrefMatch = /\bhref="([^"]+)"/.exec(attrs);
    if (isPdf && hrefMatch && hrefMatch[1]) {
      pdfUrl = hrefMatch[1];
      break;
    }
  }

  const out: {
    title: string;
    abstract: string;
    authors: string[];
    publishedYear?: string;
    pdfUrl?: string;
    canonicalUrl: string;
  } = {
    title,
    abstract,
    authors,
    canonicalUrl: `https://arxiv.org/abs/${arxivId}`,
  };
  if (publishedYear !== undefined) out.publishedYear = publishedYear;
  if (pdfUrl !== undefined) out.pdfUrl = pdfUrl;
  return out;
}

function sliceTag(haystack: string, tag: string): string | null {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "i");
  const close = new RegExp(`</${tag}>`, "i");
  const a = open.exec(haystack);
  if (!a) return null;
  const after = haystack.slice(a.index + a[0].length);
  const b = close.exec(after);
  if (!b) return null;
  return after.slice(0, b.index);
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export async function fetchArxiv(
  arxivId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ArxivFetchResult> {
  const endpoint = `${ARXIV_API}?id_list=${encodeURIComponent(arxivId)}`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/atom+xml" },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ResearchError(0, "fetch_failed", `arXiv unreachable: ${msg}`);
  }
  if (!res.ok) {
    throw new ResearchError(
      res.status,
      "upstream_error",
      `arXiv returned ${res.status}`,
    );
  }
  const xml = await res.text();
  const parsed = parseArxivAtom(xml, arxivId);
  if (parsed.title.length === 0 && parsed.abstract.length === 0) {
    throw new ResearchError(
      404,
      "not_found",
      `arXiv id ${arxivId} returned no entry`,
    );
  }
  const lines: string[] = [`# ${parsed.title}`, ""];
  if (parsed.authors.length > 0) {
    lines.push(`**Authors:** ${parsed.authors.join(", ")}`, "");
  }
  if (parsed.publishedYear) {
    lines.push(`**Year:** ${parsed.publishedYear}`, "");
  }
  lines.push(
    `**arXiv:** [${arxivId}](${parsed.canonicalUrl})`,
    "",
    "## Abstract",
    "",
    parsed.abstract,
    "",
  );
  const markdown = lines.join("\n").trim();
  const result: ArxivFetchResult = {
    markdown,
    url: parsed.canonicalUrl,
    title: parsed.title,
    author: parsed.authors.length > 0 ? parsed.authors.join(", ") : undefined,
    byteSize: new Blob([markdown]).size,
    providerId: "readability",
    meta: {
      extractor: "arxiv-api",
      arxivId,
      publishedYear: parsed.publishedYear,
    },
  };
  if (parsed.pdfUrl) result.pdfUrl = parsed.pdfUrl;
  return result;
}
