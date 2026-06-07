// Concept graph for the Mind Map view (4.E + 4.F). Concepts and edges live
// in their own Dexie tables (Schema v12) so they can be regenerated as a
// unit per workspace without touching chunks/flashcards/etc.
//
// `chunkRefs` on a concept are the chunk ids that mention the concept; the
// inspector uses these to render backlinks. `evidenceChunkIds` on an edge
// are the chunks that *justify* the relation (typically the chunks where
// both concepts co-occurred).

export type ConceptKind =
  | "concept" // generic abstract idea
  | "term" // formal vocabulary item
  | "person"
  | "place"
  | "method"
  | "event"
  | "work"; // book / paper / artifact

export type ConceptEdgeKind =
  | "is-a" // taxonomy / subclass
  | "part-of" // composition / mereology
  | "related" // weak association
  | "depends-on"; // causal / prerequisite

export type ConceptRecord = {
  id: string;
  workspaceId: string;
  label: string;
  // Lowercase + Unicode-normalized form used for dedupe and exact lookup.
  // Indexed so the extractor can quickly find an existing concept by name.
  // ALWAYS normalized from the PRIMARY (base) label — never the English
  // translation — so "both"-mode dedupe stays keyed on a single language.
  labelNorm: string;
  kind: ConceptKind;
  definition?: string;
  // Bilingual companions for "both"-mode extraction (Phase: content-language).
  // The base `label`/`definition` always hold Turkish; these *En fields always
  // hold English. Optional + non-indexed → no Dexie version bump. The map view
  // gates its TR/EN toggle on "some visible concept has labelEn".
  labelEn?: string;
  definitionEn?: string;
  // Source ids the concept appears in (union across runs). Useful for the
  // workspace-level mind map to know which sources contributed.
  sourceIds: string[];
  // Chunk ids that mention this concept. The inspector renders quote spans
  // by joining against the chunks table.
  chunkRefs: string[];
  // Optional embedding for cosine-sim dedupe in later passes. Stored as a
  // plain number[] so it survives Dexie round-trips without typed array
  // hassles.
  embedding?: number[];
  embeddingDim?: number;
  embeddingProvider?: string;
  embeddingModel?: string;
  createdAt: number;
  updatedAt: number;
};

export type ConceptEdgeRecord = {
  id: string;
  workspaceId: string;
  fromId: string;
  toId: string;
  kind: ConceptEdgeKind;
  evidenceChunkIds: string[];
  createdAt: number;
};
