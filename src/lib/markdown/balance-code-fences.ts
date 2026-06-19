/**
 * Repairs malformed fenced code blocks before markdown reaches the renderer.
 *
 * WHY: two real-world sources produce broken fences:
 *   1. LLM lessons that forget a closing ```.
 *   2. The reader, which renders a SOURCE one chunk at a time — the chunker can
 *      split a document mid-fence, so a chunk begins with an *orphan closing*
 *      ``` (no matching open in that chunk).
 * Either way the parser wraps prose, headings, tables and $$math$$ inside a code
 * box (the "inverted markdown" bug). VS Code never shows this because it parses
 * the whole file, where fences are balanced.
 *
 * A naive open/close counter is NOT enough: an orphan closing fence pairs with a
 * later real close, and a `\`\`\`python` line in between is swallowed as block
 * content, so the document *looks* balanced while the pairing is actually
 * inverted. We therefore detect MISPLACED fences by content, not parity.
 *
 * STRATEGY — surgical, never touches well-formed input:
 *   1. If no fence is unclosed and no fenced region's body looks misplaced,
 *      return the input UNCHANGED.
 *   2. Otherwise repair: a fenced region whose body contains a *nested fence
 *      line*, a *table row*, or a ***bold label*** is spurious — drop its opening
 *      marker so the body renders as markdown. Genuine code regions are emitted
 *      as proper fenced blocks, closing one at EOF if needed.
 *
 * NB: we deliberately do NOT treat an ATX `#` line as a spurious signal — that
 * would match Python/shell `# comments` inside legitimate code.
 */

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const TABLE_ROW = /^ {0,3}\|.*\|/;
const BOLD_LABEL = /^\s*\*\*[^*]+\*\*/;

function isClosingFence(line: string, marker: string): boolean {
  const m = line.match(/^( {0,3})(`{3,}|~{3,})\s*$/);
  if (!m) return false;
  const fence = m[2] ?? "";
  return fence[0] === marker[0] && fence.length >= marker.length;
}

/** A real code body never contains a fence line, a markdown table row, or a
 *  bold-label line; if this one does, the enclosing fence is misplaced. */
function bodyIsSpurious(body: string[]): boolean {
  return body.some(
    (l) => FENCE_OPEN.test(l) || TABLE_ROW.test(l) || BOLD_LABEL.test(l),
  );
}

/** True when some fence is left unclosed, or some fenced region is misplaced. */
function needsRepair(lines: string[]): boolean {
  let i = 0;
  while (i < lines.length) {
    const m = (lines[i] ?? "").match(FENCE_OPEN);
    if (!m) {
      i += 1;
      continue;
    }
    const marker = m[2] ?? "";
    let j = i + 1;
    while (j < lines.length && !isClosingFence(lines[j] ?? "", marker)) j += 1;
    if (j >= lines.length) return true; // unclosed
    if (bodyIsSpurious(lines.slice(i + 1, j))) return true;
    i = j + 1;
  }
  return false;
}

export function balanceCodeFences(markdown: string): string {
  const lines = markdown.split("\n");
  if (!needsRepair(lines)) return markdown;

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
    let j = i + 1;
    while (j < lines.length && !isClosingFence(lines[j] ?? "", marker)) j += 1;
    const body = lines.slice(i + 1, j);

    if (bodyIsSpurious(body)) {
      // Misplaced fence (orphan close, or a forgotten close wrapping prose):
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
