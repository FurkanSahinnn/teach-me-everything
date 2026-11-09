// Narrow allowlist for the inline HTML the notes editor writes (Colored Text /
// Editing Toolbar compatible), so a vault renders the same here as in Obsidian.
//
// `html: false` stays on: this plugin does NOT pass HTML through. It recognises
// a handful of exact tag shapes with validated colours and re-emits tags it
// builds itself from the validated values. Everything else — `<script>`,
// `<img onerror>`, `<span style="color:red;background:url(x)">`, unbalanced
// tags — remains escaped text.

import type MarkdownIt from "markdown-it";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type Token from "markdown-it/lib/token.mjs";
import {
  isSafeCssColor,
  matchCloseTag,
  matchOpenTag,
  parseAlignWrapper,
  type HtmlKind,
} from "@/lib/notes/inline-html-tags";

type OpenMeta = { kind: HtmlKind; value: string | null; closeName: string; raw: string };
type CloseMeta = { name: string; raw: string; kind?: HtmlKind };

const ALIGN_FORBIDDEN_RE = /<\/?(?:p|center)\b/i;

export function inlineHtmlAllowlistPlugin(md: MarkdownIt): void {
  const esc = md.utils.escapeHtml;

  md.inline.ruler.before("autolink", "inline_html_allowlist", (state: StateInline, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
    const open = matchOpenTag(state.src, state.pos);
    if (open) {
      if (!silent) {
        const token = state.push("inline_html_open", "", 0);
        const meta: OpenMeta = {
          kind: open.kind,
          value: open.value,
          closeName: open.closeName,
          raw: state.src.slice(state.pos, state.pos + open.length),
        };
        token.meta = meta;
      }
      state.pos += open.length;
      return true;
    }
    const close = matchCloseTag(state.src, state.pos);
    if (!close) return false;
    if (!silent) {
      const token = state.push("inline_html_close", "", 0);
      const meta: CloseMeta = { name: close.name, raw: state.src.slice(state.pos, state.pos + close.length) };
      token.meta = meta;
    }
    state.pos += close.length;
    return true;
  });

  // Pair tags per inline run; anything unmatched goes back to plain (escaped) text.
  md.core.ruler.after("inline", "inline_html_allowlist_balance", (state: StateCore) => {
    for (const block of state.tokens) {
      if (block.type === "inline" && block.children) pairTags(block.children);
    }
    return true;
  });

  md.renderer.rules.inline_html_open = (tokens: Token[], idx: number) => {
    const meta = tokens[idx]?.meta as OpenMeta | undefined;
    if (!meta) return "";
    switch (meta.kind) {
      case "color":
        return meta.value !== null && isSafeCssColor(meta.value)
          ? `<span class="md-color" style="color:${esc(meta.value)}">`
          : esc(meta.raw);
      case "bg":
        return meta.value !== null && isSafeCssColor(meta.value)
          ? `<mark class="md-bg" style="background:${esc(meta.value)}">`
          : esc(meta.raw);
      default:
        return `<${meta.kind}>`;
    }
  };
  md.renderer.rules.inline_html_close = (tokens: Token[], idx: number) => {
    const meta = tokens[idx]?.meta as CloseMeta | undefined;
    if (!meta?.kind) return esc(meta?.raw ?? "");
    if (meta.kind === "color") return "</span>";
    if (meta.kind === "bg") return "</mark>";
    return `</${meta.kind}>`;
  };

  // `<p align="center">…</p>` / `<center>…</center>` covering a whole paragraph
  // or heading becomes a class on that block; the tags themselves never render.
  md.core.ruler.before("inline", "inline_html_allowlist_align", (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 1; i < tokens.length; i += 1) {
      const inline = tokens[i];
      const owner = tokens[i - 1];
      if (
        !inline ||
        inline.type !== "inline" ||
        (owner?.type !== "paragraph_open" && owner?.type !== "heading_open")
      ) {
        continue;
      }
      const parsed = parseAlignWrapper(inline.content);
      if (!parsed || ALIGN_FORBIDDEN_RE.test(parsed.inner)) continue;
      inline.content = parsed.inner.trim();
      owner.attrJoin("class", `md-align-${parsed.align}`);
    }
    return true;
  });
}

function pairTags(children: Token[]): void {
  const stack: Token[] = [];
  const claimed = new Set<Token>();
  for (const child of children) {
    if (child.type === "inline_html_open") {
      stack.push(child);
      continue;
    }
    if (child.type !== "inline_html_close") continue;
    const meta = child.meta as CloseMeta;
    let matched = -1;
    for (let s = stack.length - 1; s >= 0; s -= 1) {
      if ((stack[s]!.meta as OpenMeta).closeName === meta.name) {
        matched = s;
        break;
      }
    }
    if (matched === -1) {
      child.type = "text";
      child.content = meta.raw;
      continue;
    }
    const open = stack[matched]!;
    meta.kind = (open.meta as OpenMeta).kind;
    claimed.add(open);
    // Opens stacked above the match never closed; they stay unclaimed.
    stack.length = matched;
  }
  for (const child of children) {
    if (child.type !== "inline_html_open" || claimed.has(child)) continue;
    child.type = "text";
    child.content = (child.meta as OpenMeta).raw;
  }
}
