/**
 * Repairs unbalanced fenced code blocks in markdown before it reaches the
 * renderer.
 *
 * WHY: LLM-generated lessons (and pasted documents) routinely drop a closing
 * ` ``` `. CommonMark/micromark reacts catastrophically: a single unclosed
 * fence flips the polarity of *every* fence below it, so prose, headings and
 * blockquotes render inside code boxes while the real code diagrams render as
 * plain paragraphs (the "inverted markdown" bug). VS Code's markdown-it is more
 * forgiving; this brings our renderer to parity.
 *
 * STRATEGY — surgical, never touches well-formed input:
 *   1. Walk the document with a CommonMark-ish fence state machine.
 *   2. If every fence is balanced, return the input UNCHANGED. This is the
 *      critical guard: a legitimate code block may contain `## comment`,
 *      `#define`, `---` etc., and we must never rewrite those.
 *   3. Only when a fence is left open do we repair: a code fence that is still
 *      open when an ATX heading or thematic break appears at column 0 is almost
 *      certainly a forgotten close, so we inject the closing fence there. Any
 *      fence still open at end-of-document is closed at EOF (matching
 *      markdown-it's "code runs to the end" behaviour instead of inverting).
 */

// Opening fence: up to 3 leading spaces, then ≥3 backticks or tildes, optional
// info string. Closing fence: same marker char, length ≥ opening, only trailing
// whitespace allowed after it.
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX_HEADING = /^ {0,3}#{1,6}(\s|$)/;
const THEMATIC_BREAK = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;

function isClosingFence(line: string, marker: string): boolean {
  const m = line.match(/^( {0,3})(`{3,}|~{3,})\s*$/);
  if (!m) return false;
  const fence = m[2] ?? "";
  return fence[0] === marker[0] && fence.length >= marker.length;
}

/** True when the markdown contains at least one unclosed fenced code block. */
function hasUnbalancedFence(lines: string[]): boolean {
  let openMarker: string | null = null;
  for (const line of lines) {
    if (openMarker === null) {
      const m = line.match(FENCE_OPEN);
      if (m) openMarker = m[2] ?? "";
    } else if (isClosingFence(line, openMarker)) {
      openMarker = null;
    }
  }
  return openMarker !== null;
}

export function balanceCodeFences(markdown: string): string {
  const lines = markdown.split("\n");
  if (!hasUnbalancedFence(lines)) return markdown;

  const out: string[] = [];
  let openMarker: string | null = null;
  for (const line of lines) {
    if (openMarker === null) {
      out.push(line);
      const m = line.match(FENCE_OPEN);
      if (m) openMarker = m[2] ?? "";
      continue;
    }
    // Inside a fence. A real close ends it normally.
    if (isClosingFence(line, openMarker)) {
      out.push(line);
      openMarker = null;
      continue;
    }
    // A heading or thematic break inside an open fence means the close was
    // forgotten: inject it, then re-process this line as ordinary markdown.
    if (ATX_HEADING.test(line) || THEMATIC_BREAK.test(line)) {
      out.push(openMarker[0] === "~" ? "~~~" : "```");
      out.push("");
      openMarker = null;
      out.push(line);
      const m = line.match(FENCE_OPEN);
      if (m) openMarker = m[2] ?? "";
      continue;
    }
    out.push(line);
  }
  // Anything still open runs to EOF — close it so it cannot swallow nothing.
  if (openMarker !== null) {
    out.push(openMarker[0] === "~" ? "~~~" : "```");
  }
  return out.join("\n");
}
