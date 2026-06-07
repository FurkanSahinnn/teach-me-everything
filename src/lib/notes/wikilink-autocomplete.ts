/**
 * Phase 6.5 — CodeMirror 6 autocompletion source for `[[wikilinks]]`.
 *
 * Triggers when the cursor sits after an unclosed `[[`. Pulls suggestions
 * from a `WikilinkLookups` map (built upstream by the React shell from
 * `useLiveQuery`) via a getter callback — keeps the editor extension
 * stateless and lets React drive live updates without re-mounting CM6.
 *
 * Each suggestion's `apply` replaces the partial `[[query` with the
 * canonical `[[<insertText>]]` and parks the cursor just past the closing
 * brackets. If the user already typed the trailing `]]`, we don't add a
 * second pair — we just rewrite the inner target and walk the cursor past.
 */

import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  autocompletion,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { buildWikilinkSuggestions } from "./wikilink-resolver";
import type { WikilinkLookups, WikilinkSuggestion } from "./wikilink-resolver";

/**
 * Callback that returns the current snapshot of workspace entities. The
 * React shell wraps a `useRef` around the latest lookups so the source
 * always sees fresh data without re-creating the extension.
 */
export type WikilinkLookupsProvider = () => WikilinkLookups | null;

export type WikilinkAutocompleteOptions = {
  getLookups: WikilinkLookupsProvider;
  /** Max suggestions shown per dropdown. Default 30. */
  limit?: number;
};

/**
 * CM6 extension factory. Returns an `autocompletion` extension with the
 * wikilink source as the only override.
 */
export function wikilinkAutocomplete(
  options: WikilinkAutocompleteOptions,
): Extension {
  return autocompletion({
    override: [makeWikilinkSource(options)],
    activateOnTyping: true,
    closeOnBlur: true,
    icons: false,
    defaultKeymap: true,
  });
}

const TRIGGER_RE = /\[\[([^\]\n]*)$/u;

/**
 * The completion source. Exported for unit testing — feed it a synthetic
 * `CompletionContext`-shaped object and assert the returned result.
 */
export function makeWikilinkSource(options: WikilinkAutocompleteOptions) {
  const limit = options.limit ?? 30;
  return (context: CompletionContext): CompletionResult | null => {
    const before = context.matchBefore(TRIGGER_RE);
    if (!before) return null;
    // Don't open the dropdown for a bare cursor unless the user explicitly
    // hit Ctrl+Space — but `before.from === before.to` would only happen
    // when the regex matched zero chars, which it can't here (the regex
    // requires `[[`). Keep the guard for forward-compat.
    if (before.from === before.to && !context.explicit) return null;

    const lookups = options.getLookups();
    if (!lookups) return null;

    // `before.text` is the matched substring including the leading `[[`.
    const query = before.text.startsWith("[[") ? before.text.slice(2) : before.text;
    const suggestions = buildWikilinkSuggestions(query, lookups, limit);

    // Detect whether the user already typed the closing `]]` right after
    // the cursor. If yes, the `apply` skips inserting another pair.
    const docLen = context.state.doc.length;
    const tail = context.state.sliceDoc(context.pos, Math.min(context.pos + 2, docLen));
    const hasTrailingBrackets = tail === "]]";

    const options_ = suggestions.map((sug) =>
      buildCompletion(sug, hasTrailingBrackets),
    );

    return {
      from: before.from + 2, // start replacement *after* `[[`
      to: context.pos,
      options: options_,
      // Disable CM6's built-in fuzzy filtering — we already ranked the
      // suggestions in `buildWikilinkSuggestions`.
      filter: false,
      // Keep the dropdown open while the user types non-bracket characters.
      validFor: /^[^\]\n]*$/u,
    };
  };
}

function buildCompletion(
  suggestion: WikilinkSuggestion,
  hasTrailingBrackets: boolean,
): Completion {
  return {
    label: suggestion.label,
    detail: suggestion.detail,
    type: suggestion.kind,
    boost: suggestion.score,
    apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
      // `from` is the position just past `[[`; `to` is the cursor. Replace
      // the inner target with `suggestion.insertText` and close the link
      // (skipped when the user already typed `]]` after the cursor).
      const insert = hasTrailingBrackets
        ? suggestion.insertText
        : `${suggestion.insertText}]]`;
      const cursorOffset = from + suggestion.insertText.length + 2;

      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: cursorOffset },
        userEvent: "input.complete.wikilink",
      });
    },
  };
}
