/**
 * Horizontal rules, images and footnotes: single-line replace widgets that
 * are safe inside the ViewPlugin (none of them hides a line break).
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecoSpec } from "./types";

export type ImageMatch = { from: number; to: number; alt: string; url: string; width: number | null; height: number | null };

const IMAGE_RE = /!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g;
const SAFE_URL_RE = /^(?:https?:\/\/|data:image\/)/i;

/** `alt|300` / `alt|300x200` (Obsidian) -> alt text + size. */
export function parseImageAlt(raw: string): { alt: string; width: number | null; height: number | null } {
  const m = /^(.*?)\|(\d+)(?:x(\d+))?\s*$/.exec(raw);
  if (!m) return { alt: raw, width: null, height: null };
  return { alt: (m[1] ?? "").trim(), width: Number(m[2]), height: m[3] ? Number(m[3]) : null };
}

/** Images whose URL is safe to load; everything else stays raw text. */
export function scanImages(text: string): ImageMatch[] {
  const out: ImageMatch[] = [];
  IMAGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMAGE_RE.exec(text)) !== null) {
    const url = (m[2] ?? "").replace(/^<|>$/g, "");
    if (!SAFE_URL_RE.test(url)) continue;
    if (m.index > 0 && text[m.index - 1] === "\\") continue;
    out.push({ from: m.index, to: m.index + m[0].length, url, ...parseImageAlt(m[1] ?? "") });
  }
  return out;
}

export type FootnoteMatch = { from: number; to: number; id: string; isDefinition: boolean };

/** `[^id]` references and a leading `[^id]:` definition marker. */
export function scanFootnotes(text: string): FootnoteMatch[] {
  const out: FootnoteMatch[] = [];
  const re = /\[\^([^\]\s]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > 0 && text[m.index - 1] === "\\") continue;
    const isDefinition = m.index === 0 && text[m[0].length] === ":";
    const to = m.index + m[0].length + (isDefinition ? 1 : 0);
    out.push({ from: m.index, to, id: m[1] ?? "", isDefinition });
  }
  return out;
}

/** Last line of a leading `---` YAML block, or 0 when there is none. */
export function frontmatterEndLine(firstLines: readonly string[]): number {
  if (firstLines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < firstLines.length; i++) {
    if (firstLines[i]?.trim() === "---" || firstLines[i]?.trim() === "...") return i + 1;
  }
  return 0;
}

class RuleWidget extends WidgetType {
  override eq(other: WidgetType): boolean {
    return other instanceof RuleWidget;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-tme-hr";
    return el;
  }
}

class ImageWidget extends WidgetType {
  constructor(private readonly m: ImageMatch) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return (
      other instanceof ImageWidget &&
      other.m.url === this.m.url &&
      other.m.alt === this.m.alt &&
      other.m.width === this.m.width &&
      other.m.height === this.m.height
    );
  }
  override toDOM(): HTMLElement {
    const img = document.createElement("img");
    img.className = "cm-tme-image";
    img.loading = "lazy";
    img.alt = this.m.alt;
    img.src = this.m.url;
    if (this.m.width !== null) img.style.width = `${this.m.width}px`;
    if (this.m.height !== null) img.style.height = `${this.m.height}px`;
    return img;
  }
}

class FootnoteWidget extends WidgetType {
  constructor(
    private readonly id: string,
    private readonly isDefinition: boolean,
  ) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return other instanceof FootnoteWidget && other.id === this.id && other.isDefinition === this.isDefinition;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("sup");
    el.className = this.isDefinition ? "cm-tme-fnref cm-tme-fnref--def" : "cm-tme-fnref";
    el.textContent = this.id;
    return el;
  }
}

const RULE = Decoration.replace({ widget: new RuleWidget() });
const FN_DEF_LINE = Decoration.line({ attributes: { class: "cm-tme-fndef" } });

export function buildInlineBlockDecorations(
  state: EditorState,
  activeLines: Set<number>,
  from: number,
  to: number,
  out: DecoSpec[],
  codeRanges: ReadonlyArray<readonly [number, number]>,
): void {
  const inCode = (pos: number): boolean => codeRanges.some(([f, t]) => pos >= f && pos < t);

  // Horizontal rules come from the tree so setext underlines and code stay out.
  const fmEnd = state.doc.lines > 0 && state.doc.line(1).text.trim() === "---"
    ? frontmatterEndLine(Array.from({ length: Math.min(state.doc.lines, 200) }, (_, i) => state.doc.line(i + 1).text))
    : 0;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "HorizontalRule") return;
      const line = state.doc.lineAt(node.from);
      if (line.number <= fmEnd || activeLines.has(line.number)) return;
      out.push({ from: node.from, to: node.to, deco: RULE });
    },
  });

  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    const active = activeLines.has(n);
    const text = line.text;
    if (text.includes("[^")) {
      for (const f of scanFootnotes(text)) {
        if (inCode(line.from + f.from)) continue;
        if (f.isDefinition) out.push({ from: line.from, to: line.from, deco: FN_DEF_LINE });
        if (active) continue;
        out.push({
          from: line.from + f.from,
          to: line.from + f.to,
          deco: Decoration.replace({ widget: new FootnoteWidget(f.id, f.isDefinition) }),
        });
      }
    }
    if (!active && text.includes("![")) {
      for (const m of scanImages(text)) {
        if (inCode(line.from + m.from)) continue;
        out.push({ from: line.from + m.from, to: line.from + m.to, deco: Decoration.replace({ widget: new ImageWidget(m) }) });
      }
    }
  }
}

export const inlineBlocksTheme: Extension = EditorView.theme({
  ".cm-tme-hr": {
    display: "block",
    height: "0",
    margin: "0.7em 0",
    borderTop: "1px solid var(--color-rule-strong)",
  },
  ".cm-tme-image": {
    maxWidth: "100%",
    borderRadius: "6px",
    verticalAlign: "middle",
  },
  ".cm-tme-fnref": {
    fontSize: "0.72em",
    padding: "0 4px",
    borderRadius: "999px",
    backgroundColor: "var(--color-accent-wash)",
    color: "var(--color-accent-ink)",
    fontWeight: "600",
    verticalAlign: "super",
    lineHeight: "1",
  },
  ".cm-tme-fnref--def": { marginRight: "4px" },
  ".cm-tme-fndef": {
    fontSize: "0.88em",
    color: "var(--color-ink-3)",
  },
});
