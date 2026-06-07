/**
 * Phase 6.3 — Cursor-aware decoration helpers + source-mode toggle.
 *
 * The live-preview ViewPlugin needs to know which lines are "active" (touched
 * by the cursor or any selection range) so it can leave their raw markdown
 * visible while rendering inactive lines as prose. `computeActiveLineNumbers`
 * is the single source of truth for that set — pure so it can be unit-tested.
 *
 * `sourceModeField` + `toggleSourceModeEffect` model the Obsidian-style
 * `Ctrl+E` swap. When `true`, decoration builders short-circuit to an empty
 * `DecorationSet`, leaving CM6 in plain markdown source mode. We use a state
 * field rather than `Compartment.reconfigure` so the same plugin instance
 * handles both modes — no teardown/setup churn on every toggle.
 */

import { type EditorState, StateEffect, StateField } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate, keymap } from "@codemirror/view";

/**
 * Collect every 1-based line number touched by the current selection. A
 * cursor at the very start of a line counts that line as active; a range
 * spanning multiple lines marks each one. Empty selections (the common case)
 * yield a single-line set.
 */
export function computeActiveLineNumbers(state: EditorState): Set<number> {
  const out = new Set<number>();
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toLine = state.doc.lineAt(range.to).number;
    for (let n = fromLine; n <= toLine; n++) out.add(n);
  }
  return out;
}

/**
 * Toggle effect for source mode. `undefined` flips the current value; an
 * explicit boolean overrides it (used by the React layer to force a state).
 */
export const toggleSourceModeEffect = StateEffect.define<boolean | undefined>();

/**
 * Persisted boolean: `false` (default) → live preview on; `true` → raw mode.
 */
export const sourceModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(toggleSourceModeEffect)) {
        return effect.value === undefined ? !value : effect.value;
      }
    }
    return value;
  },
});

/**
 * `Mod-e` toggles source mode. Returns `true` so the key consumer is aware
 * the event was handled (prevents the default browser shortcut, e.g. caret
 * jump on Windows).
 */
export const sourceModeKeymap = keymap.of([
  {
    key: "Mod-e",
    preventDefault: true,
    run(view) {
      view.dispatch({ effects: toggleSourceModeEffect.of(undefined) });
      return true;
    },
  },
]);

/**
 * Build a ViewPlugin that fires `onChange(active)` whenever the source-mode
 * boolean flips. Used by the React shell to update the footer pill without
 * polling editor state every render.
 */
export function sourceModeNotifier(onChange: (active: boolean) => void) {
  return ViewPlugin.fromClass(
    class {
      private last: boolean;
      constructor(view: EditorView) {
        this.last = view.state.field(sourceModeField, false) ?? false;
        // Defer the initial callback to the next microtask so React parents
        // can finish their commit before we trigger a setState.
        queueMicrotask(() => onChange(this.last));
      }
      update(update: ViewUpdate) {
        const next = update.state.field(sourceModeField, false) ?? false;
        if (next !== this.last) {
          this.last = next;
          onChange(next);
        }
      }
    },
  );
}

/**
 * Convenience: set source mode to an explicit value from outside the editor
 * (e.g. a toolbar button click). Returns `true` on success.
 */
export function setSourceMode(view: EditorView, active: boolean): boolean {
  view.dispatch({ effects: toggleSourceModeEffect.of(active) });
  return true;
}

/**
 * Read the current source-mode flag. Returns `false` if the state field
 * isn't registered yet (shouldn't happen in normal use, but safe default).
 */
export function isSourceModeActive(state: EditorState): boolean {
  return state.field(sourceModeField, false) ?? false;
}
