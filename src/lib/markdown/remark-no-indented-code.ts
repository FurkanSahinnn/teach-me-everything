import type { Data, Processor } from "unified";

/** The slice of a micromark extension we set — only the `disable` directive.
 *  unified's public `Data` type doesn't surface `micromarkExtensions` unless
 *  `remark-parse`'s module augmentation happens to be in scope, so we narrow
 *  locally (an all-optional shape `Data` is already assignable to) instead of
 *  depending on that augmentation being loaded. */
type WithMicromarkExtensions = {
  micromarkExtensions?: Array<{ disable?: { null?: string[] } }>;
};

/**
 * remark/unified plugin that disables CommonMark **indented** code blocks
 * (4-space / tab) at the micromark tokenizer level.
 *
 * WHY: LLM answers and pasted documents routinely over-indent prose by four or
 * more spaces (or a tab). The default CommonMark parser treats those lines as
 * an *indented code block*, so headings, lists, `**bold**` — and even nested
 * ` ``` ` fences — render as raw monospace text inside a code box (the
 * "everything turned into a code block" bug). Indented code blocks are an
 * obsolete authoring style; in this app code is always **fenced** (` ``` `),
 * so disabling the construct is pure upside: fenced code, inline code and
 * `$…$` / `$$…$$` math are all left untouched.
 */
export function remarkNoIndentedCode(this: Processor): void {
  const data = this.data() as Data & WithMicromarkExtensions;
  const extensions = data.micromarkExtensions ?? [];
  extensions.push({ disable: { null: ["codeIndented"] } });
  data.micromarkExtensions = extensions;
}
