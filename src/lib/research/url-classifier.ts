// Pure URL classifier — single entry point for "user pasted something into
// the Add URL box". Dispatches to the right ingest channel without leaking
// regex knowledge into the UI.

/** DOI pattern from the official CrossRef ABNF — kept conservative. */
const DOI_PATTERN = /^10\.\d{4,9}\/[^\s]+$/;

const YOUTUBE_VIDEO_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

const ARXIV_HOSTS = new Set(["arxiv.org", "www.arxiv.org", "export.arxiv.org"]);

export type ClassifiedUrl =
  | { kind: "doi"; doi: string; raw: string }
  | { kind: "youtube"; videoId: string; raw: string }
  | { kind: "arxiv"; arxivId: string; raw: string }
  | { kind: "web"; url: string; raw: string }
  | { kind: "invalid"; raw: string; reason: "empty" | "malformed" };

/**
 * Classify a user-pasted string into one of the supported research channels.
 * Pure function — no I/O. Defaults to "web" when the input parses as an
 * http(s) URL but doesn't match any specialized provider pattern.
 */
export function classifyUrl(input: string): ClassifiedUrl {
  const raw = (input ?? "").trim();
  if (raw.length === 0) return { kind: "invalid", raw, reason: "empty" };

  // Raw DOI (no scheme, no host) — accept as-is so users can paste straight
  // from CrossRef citations without prefixing https://doi.org/.
  if (DOI_PATTERN.test(raw)) {
    return { kind: "doi", doi: raw, raw };
  }

  // Normalize the input: only http(s) URLs are accepted. Scheme handling:
  //   - http:// or https:// → parse as-is
  //   - other valid scheme (ftp:, javascript:, mailto:, …) → reject up front
  //     so the URL() lenient parse can't promote them to "web".
  //   - input contains `:` but the prefix is not a valid scheme (e.g. the
  //     deliberately-broken "ht!tp://…") → also reject, since it clearly
  //     intended to be a URL.
  //   - no `:` at all → bare host like "example.com/foo"; prepend https://.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  let candidate: string;
  if (schemeMatch) {
    const scheme = (schemeMatch[1] ?? "").toLowerCase();
    if (scheme !== "http" && scheme !== "https") {
      return { kind: "invalid", raw, reason: "malformed" };
    }
    candidate = raw;
  } else if (raw.includes(":")) {
    return { kind: "invalid", raw, reason: "malformed" };
  } else {
    candidate = `https://${raw}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { kind: "invalid", raw, reason: "malformed" };
  }
  const host = parsed.hostname.toLowerCase();

  // doi.org / dx.doi.org — pathname starts with `/10.xxxx/...`
  if (host === "doi.org" || host === "dx.doi.org") {
    const tail = parsed.pathname.replace(/^\//, "");
    if (DOI_PATTERN.test(tail)) {
      return { kind: "doi", doi: tail, raw };
    }
    // doi.org URL but pathname isn't a valid DOI — degrade to web.
    return { kind: "web", url: parsed.toString(), raw };
  }

  // YouTube — accept watch?v= / youtu.be/ID / shorts/ID / embed/ID. Reject
  // playlist-only URLs (?list=PL...) without a v= so the user gets a clear
  // signal rather than ingesting nothing.
  if (YOUTUBE_VIDEO_HOSTS.has(host)) {
    const videoId = extractYoutubeId(parsed);
    if (videoId) {
      return { kind: "youtube", videoId, raw };
    }
    return { kind: "web", url: parsed.toString(), raw };
  }

  // arXiv — /abs/ID, /pdf/ID(.pdf), /html/ID
  if (ARXIV_HOSTS.has(host)) {
    const arxivId = extractArxivId(parsed);
    if (arxivId) {
      return { kind: "arxiv", arxivId, raw };
    }
    return { kind: "web", url: parsed.toString(), raw };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { kind: "invalid", raw, reason: "malformed" };
  }
  return { kind: "web", url: parsed.toString(), raw };
}

function extractYoutubeId(parsed: URL): string | null {
  // youtu.be/<id>
  if (parsed.hostname.toLowerCase() === "youtu.be") {
    const id = parsed.pathname.replace(/^\//, "").split("/")[0];
    return id && isLikelyYoutubeId(id) ? id : null;
  }
  // /watch?v=<id>
  const v = parsed.searchParams.get("v");
  if (v && isLikelyYoutubeId(v)) return v;
  // /shorts/<id>, /embed/<id>, /live/<id>
  const m = /^\/(?:shorts|embed|live)\/([^/?#]+)/.exec(parsed.pathname);
  if (m && m[1] && isLikelyYoutubeId(m[1])) return m[1];
  return null;
}

/** YouTube ids are 11-char base64url-safe strings. Reject anything else. */
function isLikelyYoutubeId(s: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(s);
}

function extractArxivId(parsed: URL): string | null {
  // Both pre-2007 (`hep-ph/9901234`) and post-2007 (`2401.12345` /
  // `2401.12345v2`) id forms; the matcher accepts either.
  const match = /^\/(?:abs|pdf|html)\/([a-zA-Z\-.]+\/\d{7}|\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?$/.exec(
    parsed.pathname,
  );
  if (match && match[1]) return match[1];
  return null;
}
