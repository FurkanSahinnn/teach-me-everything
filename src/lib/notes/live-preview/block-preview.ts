/**
 * Single registration point for the block-level preview modules (lists,
 * callouts, tables, math, rules, images, footnotes) so `index.ts` stays small.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";
import { buildCalloutDecorations, calloutChanged, calloutField, calloutTheme } from "./callout";
import { buildInlineBlockDecorations, inlineBlocksTheme } from "./inline-blocks";
import { buildListDecorations, listTheme } from "./list-widgets";
import { buildInlineMathDecorations, mathExtension } from "./math";
import { tableField } from "./table-widget";
import type { DecoSpec } from "./types";
import { refreshWikilinkStatus, wikilinkStatusFacet, wikilinkTheme } from "./wikilink-widget";

/** StateFields and themes; add to the editor's extension array. */
export const blockPreviewExtensions: Extension = [
  calloutField,
  calloutTheme,
  tableField,
  mathExtension,
  listTheme,
  inlineBlocksTheme,
  wikilinkTheme,
];

/** True when something outside doc/selection/focus requires a rebuild. */
export function blockPreviewNeedsRebuild(update: ViewUpdate): boolean {
  return (
    calloutChanged(update.startState, update.state) ||
    update.startState.facet(wikilinkStatusFacet) !== update.state.facet(wikilinkStatusFacet) ||
    update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshWikilinkStatus)))
  );
}

export function buildBlockPreviewDecorations(
  state: EditorState,
  activeLines: Set<number>,
  from: number,
  to: number,
  out: DecoSpec[],
): void {
  const codeRanges: Array<readonly [number, number]> = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name === "FencedCode" || node.name === "InlineCode" || node.name === "CodeBlock") {
        codeRanges.push([node.from, node.to]);
        return false;
      }
      return undefined;
    },
  });
  buildListDecorations(state, activeLines, from, to, out);
  buildCalloutDecorations(state, activeLines, from, to, out);
  buildInlineMathDecorations(state, activeLines, from, to, out, codeRanges);
  buildInlineBlockDecorations(state, activeLines, from, to, out, codeRanges);
}
