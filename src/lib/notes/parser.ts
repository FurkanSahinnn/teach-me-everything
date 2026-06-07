import type { WikilinkKind, WikilinkRef } from "@/lib/db/types";

// Strip fenced (```...```) and inline (`...`) code so the wikilink / tag
// regexes never trip on literal `[[` or `#tag` inside a code sample. Replace
// rather than remove so byte offsets stay stable for any future caller that
// wants line numbers; tests do not currently depend on offsets but a few
// expect "code block content is ignored" without affecting surrounding lines.
function stripCodeBlocks(md: string): string {
  // Fenced blocks first (greedy is fine — markdown disallows nesting them).
  const noFenced = md.replace(/```[\s\S]*?```/g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  // Inline code (single + double backticks). Same masking strategy.
  return noFenced.replace(/(`+)[^`\n]+?\1/g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
}

// Parse a single bracket target into a wikilink ref. Returns null when the
// content is empty or whitespace-only so the caller can skip `[[]]`.
function parseTarget(raw: string): WikilinkRef | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Alias: `Target|Display`. We only honour the FIRST pipe so a wikilink that
  // happens to contain another `|` keeps it as part of the alias.
  let target = trimmed;
  let alias: string | undefined;
  const pipeIdx = trimmed.indexOf("|");
  if (pipeIdx >= 0) {
    target = trimmed.slice(0, pipeIdx).trim();
    const aliasRaw = trimmed.slice(pipeIdx + 1).trim();
    if (aliasRaw.length > 0) alias = aliasRaw;
    if (target.length === 0) return null;
  }

  // Namespace prefix: `source:abc`, `concept:xyz`, `note:def`. Unknown
  // prefixes (e.g. `tag:foo`) fall back to the default "note" kind and keep
  // the prefix as part of the target so a stale wikilink stays human-readable.
  let kind: WikilinkKind = "note";
  let cleanTarget = target;
  const colonIdx = target.indexOf(":");
  if (colonIdx > 0) {
    const prefix = target.slice(0, colonIdx).toLowerCase();
    const rest = target.slice(colonIdx + 1).trim();
    if (
      (prefix === "source" || prefix === "concept" || prefix === "note") &&
      rest.length > 0
    ) {
      kind = prefix as WikilinkKind;
      cleanTarget = rest;
    }
  }

  const ref: WikilinkRef = { target: cleanTarget, kind };
  if (alias !== undefined) ref.alias = alias;
  return ref;
}

// Extract every `[[target]]` (or `[[target|alias]]`, `[[source:abc]]`) from
// markdown. Skips:
//   • content inside fenced / inline code,
//   • escaped brackets (`\[[…\]]` — a backslash immediately before either
//     bracket-pair cancels the link), and
//   • empty targets (`[[]]`).
// Order in the returned array matches order of appearance in the source so
// callers that need first-occurrence semantics (e.g. backlinks ordering) get
// it for free.
export function extractWikilinks(md: string): WikilinkRef[] {
  const masked = stripCodeBlocks(md);
  const out: WikilinkRef[] = [];
  // Lazy `.+?` so adjacent links (`[[a]][[b]]`) parse as two, not one.
  // Disallow `]` inside the target to keep parsing local.
  const re = /(\\?)\[\[([^\]\n]+?)\]\](?!\])/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(masked)) !== null) {
    if (match[1] === "\\") continue;
    const inner = match[2];
    if (inner === undefined) continue;
    const ref = parseTarget(inner);
    if (ref !== null) out.push(ref);
  }
  return out;
}

// Extract every inline `#tag` from markdown. A valid tag:
//   • starts with `#`,
//   • is preceded by start-of-string or whitespace (so `a#b` is not a tag —
//     it's part of a URL fragment or arithmetic),
//   • contains at least one letter (so `#123` is not a tag — that's a
//     section number or ordinal),
//   • allows `-`, `_`, `/` (nested), letters and digits,
//   • stops at whitespace, punctuation, or another `#`.
// Returns lowercased, deduplicated tags in order of first appearance.
export function extractTags(md: string): string[] {
  const masked = stripCodeBlocks(md);
  const seen = new Set<string>();
  const out: string[] = [];
  // Unicode letter class so Turkish (`#kimya`) and other non-ASCII alphabets
  // work without a transliteration step.
  const re = /(^|[^\p{L}\p{N}_/#-])#([\p{L}\p{N}_/-]+)/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(masked)) !== null) {
    const raw = match[2];
    if (raw === undefined) continue;
    if (!/\p{L}/u.test(raw)) continue;
    const tag = raw.toLowerCase();
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

// Pull the first ATX H1 (`# Heading`) as the note title. If no H1 exists,
// fall back to the first non-empty trimmed line (so a freshly created note
// with only `random text` still gets a sensible title). Returns an empty
// string when the document has no text at all.
export function extractTitle(md: string): string {
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const h1 = /^\s*#\s+(.+?)\s*$/.exec(line);
    if (h1 && h1[1] !== undefined) return h1[1].trim();
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && !trimmed.startsWith("#")) return trimmed;
  }
  return "";
}
