import katexPlugin from "@vscode/markdown-it-katex";
import hljs from "highlight.js";
import MarkdownIt from "markdown-it";
import { findChunkForRef } from "@/components/notebook/CitationChip";
import type { ChunkRecord } from "@/lib/db/types";
import { balanceCodeFences } from "./balance-code-fences";

/**
 * Markdown → HTML using the same engine stack VS Code's preview uses:
 * markdown-it + highlight.js + KaTeX (VS Code ships `@vscode/markdown-it-katex`
 * verbatim). We moved off react-markdown/micromark because that pipeline
 * inverted fences and mis-rendered real-world LLM lessons; markdown-it is the
 * forgiving, battle-tested parser that produces the clean output users see in
 * VS Code.
 *
 * SECURITY: `html: false` makes markdown-it ESCAPE every raw HTML byte in the
 * source. The only HTML in the output therefore comes from trusted producers —
 * markdown-it's own element generation, highlight.js (which escapes the code
 * text), the KaTeX plugin, and our citation rule (which escapes the ref). No
 * source-content path can inject markup, so the result is safe to mount via
 * dangerouslySetInnerHTML without a separate sanitizer pass.
 */

// Mirror of CitationChip's default palette so citations rendered from an HTML
// string are visually identical to the React component used elsewhere.
const CITE_ACTIVE =
  "mx-0.5 inline-flex items-baseline gap-0.5 rounded-[6px] border border-accent-soft bg-accent-wash px-1.5 py-px font-mono text-[10.5px] uppercase tracking-[0.04em] text-accent-ink transition-all duration-150 hover:-translate-y-px hover:border-accent hover:shadow-[var(--shadow-soft)]";
const CITE_INACTIVE =
  "mx-0.5 inline-flex items-baseline gap-0.5 rounded-[6px] border border-rule bg-paper-2 px-1.5 py-px font-mono text-[10.5px] uppercase tracking-[0.04em] text-ink-4 cursor-not-allowed";

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight(str: string, lang: string): string {
    // Only highlight when an explicit, known language is given — exactly like
    // VS Code. Bare ``` blocks render as plain monospace (no auto-detect), so
    // prose that slipped into an accidental fence is never syntax-coloured.
    if (lang && hljs.getLanguage(lang)) {
      try {
        const inner = hljs.highlight(str, {
          language: lang,
          ignoreIllegals: true,
        }).value;
        return `<pre class="markdown-code-block"><code class="hljs language-${md.utils.escapeHtml(
          lang,
        )}">${inner}</code></pre>`;
      } catch {
        /* fall through to plain rendering */
      }
    }
    return `<pre class="markdown-code-block"><code class="hljs">${md.utils.escapeHtml(
      str,
    )}</code></pre>`;
  },
});

// VS Code's own KaTeX plugin (handles $…$, $$…$$ and the awkward edge cases).
const useKatex = (katexPlugin as { default?: typeof katexPlugin }).default ?? katexPlugin;
md.use(useKatex, { throwOnError: false });

// Inline code: tag it so the existing .markdown-inline-code styling applies.
md.renderer.rules.code_inline = (tokens, idx) =>
  `<code class="markdown-inline-code">${md.utils.escapeHtml(tokens[idx]?.content ?? "")}</code>`;

// External links open in a new tab.
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token?.attrGet("href") ?? "";
  if (token && /^https?:\/\//i.test(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noreferrer");
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// `[§ref]` / `[Â§ref]` citations → a button the host wires up via event
// delegation (data-citation-ref). Registered before `link` so the bracket is
// claimed as a citation, not a link.
const CITATION_RE = /^\[(?:Â§|§)([^\]]+)\]/;
md.inline.ruler.before("link", "citation", (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false;
  const m = CITATION_RE.exec(state.src.slice(state.pos));
  if (!m) return false;
  if (!silent) {
    const token = state.push("citation", "", 0);
    token.content = (m[1] ?? "").trim();
  }
  state.pos += m[0].length;
  return true;
});
md.renderer.rules.citation = (tokens, idx, _options, env: MarkdownEnv) => {
  const ref = tokens[idx]?.content ?? "";
  const active = !!findChunkForRef(ref, env.citationChunks ?? []);
  const safe = md.utils.escapeHtml(ref);
  return `<button type="button"${
    active ? "" : " disabled"
  } data-citation-ref="${safe}" class="${
    active ? CITE_ACTIVE : CITE_INACTIVE
  }"><span aria-hidden="true">§</span><span class="normal-case tracking-normal">${safe}</span></button>`;
};

interface MarkdownEnv {
  citationChunks?: ChunkRecord[];
}

export function renderMarkdownToHtml(
  text: string,
  citationChunks?: ChunkRecord[],
): string {
  const normalized = balanceCodeFences(text.replace(/\r\n/g, "\n"));
  const env: MarkdownEnv = { citationChunks: citationChunks ?? [] };
  return md.render(normalized, env);
}
