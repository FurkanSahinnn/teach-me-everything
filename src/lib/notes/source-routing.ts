import type { SourceRecord } from "@/lib/db/types";

// Pure routing helper for the Sources list (Phase 6.9.6).
//
// A note-source (type: "note") was authored in the vault and embedded into
// the RAG layer. Opening it in the PDF reader makes no sense — the canonical
// surface is the notes route. PDF/URL/YouTube sources continue to land in
// /read/{id}.
//
// We accept the full SourceRecord rather than just type+noteId because the
// fallback path needs `source.id`. Returns the canonical click destination.
export function buildSourceClickHref(
  source: Pick<SourceRecord, "id" | "type" | "noteId">,
  workspaceId: string,
): string {
  if (source.type === "note" && source.noteId) {
    return `/w/${workspaceId}/notes?id=${source.noteId}`;
  }
  return `/w/${workspaceId}/read/${source.id}`;
}
