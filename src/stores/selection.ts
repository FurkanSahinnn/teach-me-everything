import { create } from "zustand";

export type SelectionData = { text: string; x: number; y: number } | null;

type SelectionState = {
  selection: SelectionData;
  setSelection: (next: SelectionData) => void;
};

// Selection lives in its own tiny store so the reader page itself does NOT
// re-render when text is selected. Without this, every selection change
// would cascade through ReaderPanel → ReaderChunkMarkdown → MarkdownPreview,
// re-parsing every chunk and visibly delaying the popover.
export const useSelection = create<SelectionState>((set) => ({
  selection: null,
  setSelection: (selection) => set({ selection }),
}));
