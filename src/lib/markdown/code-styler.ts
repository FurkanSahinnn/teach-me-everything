import hljs from "highlight.js/lib/common";
import { isLineHighlighted, parseFenceInfo } from "@/lib/notes/code-styler/params";

/**
 * Reading-view renderer for fenced code in the Obsidian "Code Styler" style.
 *
 * SECURITY: the caller runs markdown-it with `html: false`, so this module is
 * the only producer of fence markup. Every piece of user text (code, title,
 * language, labels, placeholder) goes through `escapeHtml`; highlight.js output
 * is already escaped and only contributes `<span class>` tags.
 */

export type CodeStylerLabels = {
  copy: string;
  copied: string;
  collapsed: string;
};

export const DEFAULT_CODE_LABELS: CodeStylerLabels = {
  copy: "Copy code",
  copied: "Copied",
  collapsed: "Collapsed code",
};

export function resolveCodeLabels(labels?: Partial<CodeStylerLabels>): CodeStylerLabels {
  return { ...DEFAULT_CODE_LABELS, ...labels };
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function highlightToHtml(code: string, language: string): string | null {
  if (!language || !hljs.getLanguage(language)) return null;
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}

const TAG_RE = /<span[^>]*>|<\/span>|\n/g;

/**
 * Splits highlighted HTML into per-line fragments. highlight.js spans (block
 * comments, template strings) can cross newlines, so open spans are closed at
 * each break and reopened on the next line to keep every fragment well formed.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = "";
  let last = 0;
  for (const m of html.matchAll(TAG_RE)) {
    current += html.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[0] === "\n") {
      lines.push(current + "</span>".repeat(open.length));
      current = open.join("");
    } else {
      if (m[0] === "</span>") open.pop();
      else open.push(m[0]);
      current += m[0];
    }
  }
  lines.push(current + html.slice(last));
  return lines;
}

/** Renders one fence (`code`, raw `info` string) to HTML. */
export function renderStyledFence(
  code: string,
  info: string,
  labelOverrides?: Partial<CodeStylerLabels>,
): string {
  const params = parseFenceInfo(info);
  const labels = resolveCodeLabels(labelOverrides);
  const language = params.language;
  const body = code.endsWith("\n") ? code.slice(0, -1) : code;

  const highlighted = highlightToHtml(body, language);
  const codeClass = highlighted
    ? `hljs language-${escapeHtml(language)}`
    : "hljs";
  const inner = highlighted ?? escapeHtml(body);

  if (params.ignore) {
    return `<pre class="markdown-code-block"><code class="${codeClass}">${inner}</code></pre>`;
  }

  const rawLines = body.split("\n");
  const htmlLines = splitHighlightedLines(inner);
  const lineHtml = htmlLines
    .map((html, i) => {
      const hl = isLineHighlighted(params, i + 1, rawLines[i] ?? "");
      const cls = hl ? "md-code-line md-code-line--hl" : "md-code-line";
      const ln = params.lineNumbers ? ` data-ln="${params.lineStart + i}"` : "";
      return `<span class="${cls}"${ln}>${html}</span>`;
    })
    .join("");

  const pre = `<pre class="markdown-code-block"><code class="${codeClass}">${lineHtml}</code></pre>`;
  const hasHeader = Boolean(language || params.title || params.fold);
  const classes = [
    "md-codeblock",
    params.lineNumbers ? "md-codeblock--numbered" : "",
    params.wrap === true ? "md-codeblock--wrap" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!hasHeader) return `<div class="${classes}">${pre}</div>`;

  const copyLabel = escapeHtml(labels.copy);
  const headerInner =
    (language ? `<span class="md-codeblock-lang">${escapeHtml(language)}</span>` : "") +
    (params.title ? `<span class="md-codeblock-title">${escapeHtml(params.title)}</span>` : "") +
    (params.fold
      ? `<span class="md-codeblock-placeholder">${escapeHtml(
          params.foldPlaceholder ?? labels.collapsed,
        )}</span>`
      : "") +
    `<span class="md-codeblock-spacer"></span>` +
    `<button type="button" class="md-codeblock-copy" data-code-copy ` +
    `data-label="${copyLabel}" data-copied-label="${escapeHtml(labels.copied)}" ` +
    `title="${copyLabel}">${copyLabel}</button>`;

  if (params.fold) {
    return (
      `<details class="${classes} md-codeblock--fold">` +
      `<summary class="md-codeblock-header">${headerInner}</summary>${pre}</details>`
    );
  }
  return `<div class="${classes}"><div class="md-codeblock-header">${headerInner}</div>${pre}</div>`;
}

/** Text a copy button should put on the clipboard for the block it sits in. */
export function readCodeForCopy(button: Element): string {
  const block = button.closest(".md-codeblock");
  const lines = block?.querySelectorAll(".md-code-line");
  if (lines && lines.length > 0) {
    return Array.from(lines, (l) => l.textContent ?? "").join("\n");
  }
  return block?.querySelector("pre code")?.textContent ?? "";
}
