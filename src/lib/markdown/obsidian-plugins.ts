// Obsidian-flavoured Markdown for markdown-it.
//
// CommonMark + GFM tables covers most of what users write, but the notes they
// bring from Obsidian lean on five extensions that render as literal brackets
// without help: task lists, callouts, wikilinks / embeds, footnotes and
// `==highlight==`. Each is a small rule here rather than a dependency — the
// upstream plugins either predate markdown-it 14 or pull in their own HTML
// rendering, and `html: false` in render.ts is a security property we keep.
//
// Everything emitted here goes through `escapeHtml`; no source byte reaches
// the output unescaped.

import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type Token from "markdown-it/lib/token.mjs";

const TASK_RE = /^\[( |x|X)\]\s+/;
const CALLOUT_RE = /^\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*([^\n]*)(?:\n|$)/;
const FOOTNOTE_DEF_RE = /^\[\^([^\]\s]+)\]:\s*/;
const FOOTNOTE_REF_RE = /^\[\^([^\]\s]+)\]/;
const WIKILINK_RE = /^(!?)\[\[([^\[\]|#]+)(?:#([^\[\]|]+))?(?:\|([^\[\]]+))?\]\]/;

export function obsidianPlugin(md: MarkdownIt): void {
  const esc = md.utils.escapeHtml;

  // ---------------------------------------------------------------- tasks
  // Runs before the `inline` core rule so the checkbox marker is removed from
  // the paragraph text before inline parsing sees it.
  md.core.ruler.before("inline", "obsidian_task_list", (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i += 1) {
      const inline = tokens[i];
      const para = tokens[i - 1];
      const item = tokens[i - 2];
      if (
        !inline ||
        inline.type !== "inline" ||
        para?.type !== "paragraph_open" ||
        item?.type !== "list_item_open"
      ) {
        continue;
      }
      const m = TASK_RE.exec(inline.content);
      if (!m) continue;
      inline.content = inline.content.slice(m[0].length);
      item.attrJoin("class", "task-list-item");
      // Walk back to the enclosing list so it can drop its bullets.
      for (let j = i - 3; j >= 0; j -= 1) {
        const t = tokens[j];
        if (t?.level === item.level - 1 && /^(bullet|ordered)_list_close$/.test(t.type)) break;
        if (t?.level === item.level - 1 && /^(bullet|ordered)_list_open$/.test(t.type)) {
          if (!(t.attrGet("class") ?? "").includes("contains-task-list")) {
            t.attrJoin("class", "contains-task-list");
          }
          break;
        }
      }
      const box = new state.Token("task_checkbox", "", 0);
      box.attrSet("checked", m[1] === " " ? "false" : "true");
      tokens.splice(i, 0, box);
      i += 1;
    }
  });
  md.renderer.rules.task_checkbox = (tokens: Token[], idx: number) => {
    const checked = tokens[idx]?.attrGet("checked") === "true";
    return `<input type="checkbox" class="task-list-checkbox" disabled${
      checked ? " checked" : ""
    }> `;
  };

  // ------------------------------------------------------------- callouts
  md.core.ruler.before("inline", "obsidian_callout", (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i += 1) {
      const open = tokens[i];
      const para = tokens[i + 1];
      const inline = tokens[i + 2];
      if (
        open?.type !== "blockquote_open" ||
        para?.type !== "paragraph_open" ||
        inline?.type !== "inline"
      ) {
        continue;
      }
      const m = CALLOUT_RE.exec(inline.content);
      if (!m) continue;
      const kind = (m[1] ?? "note").toLowerCase();
      const fold = m[2] ?? "";
      const title = (m[3] ?? "").trim();
      open.attrJoin("class", `callout callout-${kind}`);
      open.attrSet("data-callout", kind);
      if (fold) open.attrSet("data-callout-fold", fold);

      const titleOpen = new state.Token("callout_title_open", "div", 1);
      titleOpen.attrSet("class", "callout-title");
      titleOpen.block = true;
      const titleInline = new state.Token("inline", "", 0);
      titleInline.content = title || kind.charAt(0).toUpperCase() + kind.slice(1);
      titleInline.children = [];
      titleInline.level = titleOpen.level + 1;
      const titleClose = new state.Token("callout_title_close", "div", -1);
      titleClose.block = true;

      inline.content = inline.content.slice(m[0].length);
      const remaining = inline.content.trim().length > 0;
      if (remaining) {
        tokens.splice(i + 1, 0, titleOpen, titleInline, titleClose);
      } else {
        // Title-only callout: replace the now-empty paragraph outright.
        tokens.splice(i + 1, 3, titleOpen, titleInline, titleClose);
      }
      i += 3;
    }
  });

  // ------------------------------------------------------------ footnotes
  // Definitions (`[^1]: text`) become labelled paragraphs in place; references
  // become superscripts. No hoisting to a footer — the reader shows chunks,
  // not whole documents, so a definition may live in another chunk anyway.
  //
  // This has to be a BLOCK rule ahead of `reference`: `[^1]: text` is a valid
  // link-reference definition to CommonMark, which would swallow the line
  // silently and render nothing at all.
  md.block.ruler.before(
    "reference",
    "obsidian_footnote_def",
    (state: StateBlock, startLine, endLine, silent) => {
      const start = state.bMarks[startLine]! + state.tShift[startLine]!;
      const max = state.eMarks[startLine]!;
      const first = state.src.slice(start, max);
      const m = FOOTNOTE_DEF_RE.exec(first);
      if (!m) return false;
      if (silent) return true;

      // Lazy prose may continue, but another definition or block starts a
      // sibling, not part of this footnote.
      let next = startLine + 1;
      const terminators = state.md.block.ruler.getRules("paragraph");
      while (next < endLine && !state.isEmpty(next)) {
        if (state.sCount[next]! < state.blkIndent) break;
        if (terminators.some((rule) => rule(state, next, endLine, true))) break;
        next += 1;
      }
      const rest = [first.slice(m[0].length)];
      for (let l = startLine + 1; l < next; l += 1) {
        rest.push(state.src.slice(state.bMarks[l]! + state.tShift[l]!, state.eMarks[l]!));
      }

      const id = m[1] ?? "";
      const open = state.push("paragraph_open", "p", 1);
      open.attrSet("class", "footnote-def");
      open.attrSet("id", `fn-${id}`);
      open.map = [startLine, next];
      const label = state.push("footnote_label", "", 0);
      label.content = id;
      const inline = state.push("inline", "", 0);
      inline.content = rest.join("\n").trim();
      inline.map = [startLine, next];
      inline.children = [];
      state.push("paragraph_close", "p", -1);
      state.line = next;
      return true;
    },
    { alt: ["paragraph", "reference"] },
  );
  md.renderer.rules.footnote_label = (tokens: Token[], idx: number) =>
    `<sup class="footnote-label">${esc(tokens[idx]?.content ?? "")}</sup> `;

  md.inline.ruler.before("link", "obsidian_footnote_ref", (state: StateInline, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false;
    if (state.src.charCodeAt(state.pos + 1) !== 0x5e /* ^ */) return false;
    const m = FOOTNOTE_REF_RE.exec(state.src.slice(state.pos));
    if (!m) return false;
    if (!silent) {
      const token = state.push("footnote_ref", "", 0);
      token.content = m[1] ?? "";
    }
    state.pos += m[0].length;
    return true;
  });
  md.renderer.rules.footnote_ref = (tokens: Token[], idx: number) => {
    const id = esc(tokens[idx]?.content ?? "");
    return `<sup class="footnote-ref"><a href="#fn-${id}">${id}</a></sup>`;
  };

  // ------------------------------------------------------------ wikilinks
  md.inline.ruler.before("link", "obsidian_wikilink", (state: StateInline, silent) => {
    const c = state.src.charCodeAt(state.pos);
    const isBang = c === 0x21 /* ! */;
    if (!isBang && c !== 0x5b /* [ */) return false;
    const m = WIKILINK_RE.exec(state.src.slice(state.pos));
    if (!m) return false;
    if (!silent) {
      const token = state.push(isBang ? "wikilink_embed" : "wikilink", "", 0);
      token.attrSet("target", (m[2] ?? "").trim());
      if (m[3]) token.attrSet("heading", m[3].trim());
      token.content = (m[4] ?? m[2] ?? "").trim();
    }
    state.pos += m[0].length;
    return true;
  });
  md.renderer.rules.wikilink = (tokens: Token[], idx: number) => {
    const t = tokens[idx];
    const target = esc(t?.attrGet("target") ?? "");
    const heading = t?.attrGet("heading");
    const label = esc(t?.content ?? "");
    return `<a class="wikilink" href="#" data-wikilink="${target}"${
      heading ? ` data-wikilink-heading="${esc(heading)}"` : ""
    }>${label}</a>`;
  };
  md.renderer.rules.wikilink_embed = (tokens: Token[], idx: number) => {
    const t = tokens[idx];
    const target = esc(t?.attrGet("target") ?? "");
    return `<span class="wikilink-embed" data-wikilink="${target}">${esc(
      t?.content ?? "",
    )}</span>`;
  };

  // ------------------------------------------------------------ ==mark==
  md.inline.ruler.before("emphasis", "obsidian_mark", (state: StateInline, silent) => {
    const src = state.src;
    if (src.charCodeAt(state.pos) !== 0x3d || src.charCodeAt(state.pos + 1) !== 0x3d) {
      return false;
    }
    const end = src.indexOf("==", state.pos + 2);
    if (end === -1 || end === state.pos + 2) return false;
    const inner = src.slice(state.pos + 2, end);
    if (/^\s|\s$/.test(inner) || inner.includes("\n")) return false;
    if (!silent) {
      const open = state.push("mark_open", "mark", 1);
      open.markup = "==";
      const text = state.push("text", "", 0);
      text.content = inner;
      const close = state.push("mark_close", "mark", -1);
      close.markup = "==";
    }
    state.pos = end + 2;
    return true;
  });
}
