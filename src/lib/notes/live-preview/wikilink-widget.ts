/**
 * Phase 6.3 — `[[wikilink]]` chip widget.
 *
 * `@codemirror/lang-markdown` has no built-in wikilink token, so we do a
 * local regex pass over the viewport text and produce decorations directly.
 * The same regex shape lives in `src/lib/notes/parser.ts` for backlink
 * indexing — keep them in sync. (We can't import it here because the parser
 * version doesn't return positions.)
 *
 * Behavior per match:
 *   • Inside an active line → mark decoration with `cm-tme-wikilink-raw`
 *     so syntax is editable but visually distinct.
 *   • Inside an inactive line → `Decoration.replace` with a chip widget.
 *     Click / Enter / Space dispatches a `tme-wikilink-click` custom event
 *     so the surrounding React shell can route to the target note / source
 *     / concept (or open a "create new" prompt for missing targets — Phase
 *     6.5 will hook that flow).
 *
 * Code-block masking: we skip any match that begins inside a `FencedCode`,
 * `InlineCode`, or block `CodeBlock` node so `` `[[not a link]]` `` stays
 * literal.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import type { DecoSpec, WikilinkClickDetail } from "./types";
import { TME_EVENT } from "./types";

export type WikilinkKind = "note" | "source" | "concept";

export type WikilinkMatch = {
  /** Byte offset of `[[` (relative to whatever `scanWikilinks` was called on). */
  from: number;
  /** Byte offset just past the closing `]]`. */
  to: number;
  /** Raw `[[...]]` text including brackets. */
  raw: string;
  /** Resolved target identifier (e.g. `abc` for `[[source:abc]]`). */
  target: string;
  /** Display alias (`[[Note|Alias]]`) or null. */
  alias: string | null;
  /** Detected entity kind (defaults to `"note"` for unprefixed targets). */
  kind: WikilinkKind;
};

const WIKILINK_RE = /\[\[([^\]\n]+?)\]\](?!\])/g;

/**
 * Pure helper: scan `text` and return every wikilink match with byte
 * positions relative to `text`. Escapes (`\[[...]]`) are skipped. Empty
 * targets are skipped. Code-block masking is not done here — the caller
 * filters by Lezer node ranges (which need the editor state).
 */
export function scanWikilinks(text: string): WikilinkMatch[] {
  const out: WikilinkMatch[] = [];
  WIKILINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_RE.exec(text)) !== null) {
    const target = match[1];
    if (target === undefined) continue;
    if (target.trim().length === 0) continue;
    if (match.index > 0 && text[match.index - 1] === "\\") continue;
    const parsed = parseWikilinkTarget(target);
    out.push({
      from: match.index,
      to: match.index + match[0].length,
      raw: match[0],
      target: parsed.target,
      alias: parsed.alias,
      kind: parsed.kind,
    });
  }
  return out;
}

/**
 * Split a wikilink target into `{ kind, target, alias }`. Mirrors the rules
 * applied by `extractWikilinks` in `src/lib/notes/parser.ts`:
 *   • `Note Name`            → { kind: "note", target: "Note Name", alias: null }
 *   • `Note|Alias`           → alias = "Alias"
 *   • `source:abc`           → kind = "source", target = "abc"
 *   • `concept:xyz`          → kind = "concept", target = "xyz"
 *   • `note:def`             → kind = "note", target = "def" (redundant prefix)
 *   • `tag:foo` (unknown)    → kind = "note", target = "tag:foo"
 */
export function parseWikilinkTarget(raw: string): {
  kind: WikilinkKind;
  target: string;
  alias: string | null;
} {
  let core = raw;
  let alias: string | null = null;
  const pipeIdx = raw.indexOf("|");
  if (pipeIdx >= 0) {
    core = raw.slice(0, pipeIdx).trim();
    const aliasRaw = raw.slice(pipeIdx + 1).trim();
    alias = aliasRaw.length > 0 ? aliasRaw : null;
  } else {
    core = raw.trim();
  }

  const colonIdx = core.indexOf(":");
  if (colonIdx > 0) {
    const prefix = core.slice(0, colonIdx);
    const rest = core.slice(colonIdx + 1).trim();
    if ((prefix === "note" || prefix === "source" || prefix === "concept") && rest.length > 0) {
      return { kind: prefix, target: rest, alias };
    }
  }
  return { kind: "note", target: core, alias };
}

const ICON_FOR_KIND: Record<WikilinkKind, string> = {
  note: "📝",
  source: "📄",
  concept: "💡",
};

class WikilinkWidget extends WidgetType {
  constructor(
    private readonly detail: WikilinkClickDetail,
  ) {
    super();
  }

  override eq(other: WidgetType): boolean {
    if (!(other instanceof WikilinkWidget)) return false;
    return (
      other.detail.raw === this.detail.raw &&
      other.detail.target === this.detail.target &&
      other.detail.alias === this.detail.alias &&
      other.detail.kind === this.detail.kind
    );
  }

  override toDOM(): HTMLElement {
    const root = document.createElement("span");
    root.className = `cm-tme-wikilink cm-tme-wikilink--${this.detail.kind}`;
    root.setAttribute("role", "link");
    root.setAttribute("tabindex", "0");
    root.setAttribute("data-target", this.detail.target);
    root.setAttribute("data-kind", this.detail.kind);
    root.setAttribute("data-raw", this.detail.raw);
    if (this.detail.alias !== null) root.setAttribute("data-alias", this.detail.alias);
    root.setAttribute(
      "aria-label",
      `${this.detail.kind}: ${this.detail.alias ?? this.detail.target}`,
    );

    const icon = document.createElement("span");
    icon.className = "cm-tme-wikilink__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = ICON_FOR_KIND[this.detail.kind];

    const label = document.createElement("span");
    label.className = "cm-tme-wikilink__label";
    label.textContent = this.detail.alias ?? this.detail.target;

    root.append(icon, label);

    // Prevent caret-by-mousedown reset — CM6 normally moves the cursor to
    // the widget click position which fights the chip click semantics.
    root.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    root.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dispatchWikilinkEvent(root, this.detail);
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        dispatchWikilinkEvent(root, this.detail);
      }
    });
    return root;
  }

  override ignoreEvent(): boolean {
    // Allow click + keydown handlers above to receive their events; CM6
    // returns true here by default, which would route them back into the
    // editor as edits.
    return false;
  }
}

function dispatchWikilinkEvent(target: HTMLElement, detail: WikilinkClickDetail): void {
  target.dispatchEvent(
    new CustomEvent<WikilinkClickDetail>(TME_EVENT.wikilinkClick, {
      detail,
      bubbles: true,
      composed: true,
    }),
  );
}

const RAW_STYLE: Record<WikilinkKind, Decoration> = {
  note: Decoration.mark({ class: "cm-tme-wikilink-raw cm-tme-wikilink-raw--note" }),
  source: Decoration.mark({ class: "cm-tme-wikilink-raw cm-tme-wikilink-raw--source" }),
  concept: Decoration.mark({ class: "cm-tme-wikilink-raw cm-tme-wikilink-raw--concept" }),
};

export function buildWikilinkDecorations(
  state: EditorState,
  activeLines: Set<number>,
  from: number,
  to: number,
  out: DecoSpec[],
): void {
  // Collect code-mask ranges intersecting the viewport so we can skip
  // wikilink matches that fall inside fenced or inline code spans.
  const codeRanges: Array<[number, number]> = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (
        node.name === "FencedCode" ||
        node.name === "InlineCode" ||
        node.name === "CodeBlock"
      ) {
        codeRanges.push([node.from, node.to]);
      }
    },
  });

  const viewportText = state.doc.sliceString(from, to);
  const matches = scanWikilinks(viewportText);

  for (const m of matches) {
    const absFrom = from + m.from;
    const absTo = from + m.to;

    // Escape check at viewport boundary: scanWikilinks only sees relative
    // text, so a `\` that sits just before `from` would be invisible to it.
    if (absFrom > 0 && state.doc.sliceString(absFrom - 1, absFrom) === "\\") continue;

    // Skip matches that begin inside a code range.
    let insideCode = false;
    for (const [f, t] of codeRanges) {
      if (absFrom >= f && absFrom < t) {
        insideCode = true;
        break;
      }
    }
    if (insideCode) continue;

    const line = state.doc.lineAt(absFrom);
    if (activeLines.has(line.number)) {
      out.push({ from: absFrom, to: absTo, deco: RAW_STYLE[m.kind] });
    } else {
      const widget = new WikilinkWidget({
        raw: m.raw,
        target: m.target,
        alias: m.alias,
        kind: m.kind,
      });
      out.push({ from: absFrom, to: absTo, deco: Decoration.replace({ widget }) });
    }
  }
}
