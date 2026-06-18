// Workspace Chat — context layer types.
//
// The workspace chat injects user-toggled grounding blocks into the system
// prompt alongside the RAG-retrieved source chunks. A `ContextScope` is one
// chip in the context bar; `"sources"` and `"web"` are handled by the runner
// (RAG retrieval + the native web-search adapter respectively), so the
// builders in this folder cover only the four prose blocks.

export type ContextScope =
  | "sources"
  | "notes"
  | "concepts"
  | "roadmap"
  | "performance"
  | "web";

// A rendered context block ready to drop into the system prompt as a plain
// text segment after the (cache-controlled) sources block. `kind` excludes
// `"sources"` and `"web"` because those scopes never produce a prose block:
// sources ride the RAG chunk wrapper, web rides the provider's search tool.
export type ContextBlock = {
  kind: Exclude<ContextScope, "sources" | "web">;
  text: string;
};
