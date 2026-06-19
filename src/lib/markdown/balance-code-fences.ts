/**
 * Repairs unbalanced fenced code blocks before markdown reaches the renderer.
 *
 * WHY: two real-world sources produce an odd number of ``` fences:
 *   1. LLM lessons that forget a closing ```.
 *   2. The reader, which renders a SOURCE one chunk at a time — the chunker can
 *      split a document mid-fence, so a chunk begins with an *orphan closing*
 *      ``` (no matching open in that chunk).
 * Either way micromark/markdown-it treats the stray fence as an OPEN and wraps
 * the following prose, headings, tables and $$math$$ inside a code box (the
 * "inverted markdown" bug). VS Code never shows this because it parses the whole
 * file, where the fences are balanced.
 *
 * STRATEGY — surgical, never touches well-formed input:
 *   1. If every fence is balanced, return the input UNCHANGED. A legitimate code
 *      block may contain `## comment`, `---`, `|pipes|` etc., and must not be
 *      rewritten.
 *   2. Only when a fence is unbalanced do we repair. We scan each ``` region and
 *      ask whether its body looks like real markdown (an ATX heading, a table
 *      row, or a **bold label** line). If it does, the fence is spurious — we
 *      drop the opening marker so the body renders as markdown instead of code.
 *      Genuine code regions are emitted as proper fenced blocks (closing one at
 *      EOF if needed).
 */

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX_HEADING = /^ {0,3}#{1,6}(\s|$)/;
const TABLE_ROW = /^ {0,3}\|.*\|/;
const BOLD_LABEL = /^\s*\*\*[^*]+\*\*/;

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

/** A region whose body carries markdown structure is prose, not code. */
function bodyLooksLikeMarkdown(body: string[]): boolean {
  return body.some(
    (l) => ATX_HEADING.test(l) || TABLE_ROW.test(l) || BOLD_LABEL.test(l),
  );
}

export function balanceCodeFences(markdown: string): string {
  const lines = markdown.split("\n");
  if (!hasUnbalancedFence(lines)) return markdown;

  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const m = line.match(FENCE_OPEN);
    if (!m) {
      out.push(line);
      i += 1;
      continue;
    }
    const marker = m[2] ?? "";
    // Find the fence line that would close this one.
    let j = i + 1;
    while (j < lines.length && !isClosingFence(lines[j] ?? "", marker)) j += 1;
    const body = lines.slice(i + 1, j);

    if (bodyLooksLikeMarkdown(body)) {
      // Spurious fence (orphan close, or a forgotten-close wrapping prose):
      // drop just the opening marker and re-process the body as markdown.
      i += 1;
      continue;
    }

    // Genuine code: emit the block, synthesising a close at EOF if needed.
    out.push(line);
    for (const b of body) out.push(b);
    if (j < lines.length) {
      out.push(lines[j] ?? "");
      i = j + 1;
    } else {
      out.push(marker[0] === "~" ? "~~~" : "```");
      i = j;
    }
  }
  return out.join("\n");
}
