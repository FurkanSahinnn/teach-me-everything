import { describe, expect, it } from "vitest";
import { buildSourceClickHref } from "./source-routing";

describe("buildSourceClickHref", () => {
  it("routes note-sources to /notes with noteId query param", () => {
    expect(
      buildSourceClickHref(
        { id: "src-1", type: "note", noteId: "nt-abc" },
        "ws-1",
      ),
    ).toBe("/w/ws-1/notes?id=nt-abc");
  });

  it("falls back to /read/{id} when type is note but noteId is missing", () => {
    // Schema makes noteId optional even on type:"note" rows (orphan-tolerant
    // for the post-cascade window between deleteSource and db.notes.delete).
    // The reader is the only available surface in that case.
    expect(
      buildSourceClickHref({ id: "src-2", type: "note" }, "ws-1"),
    ).toBe("/w/ws-1/read/src-2");
  });

  it("routes pdf sources to /read/{id}", () => {
    expect(
      buildSourceClickHref({ id: "src-3", type: "pdf" }, "ws-1"),
    ).toBe("/w/ws-1/read/src-3");
  });

  it("routes url/youtube/arxiv/doi/docx all to /read/{id}", () => {
    for (const type of ["url", "youtube", "arxiv", "doi", "docx"] as const) {
      expect(
        buildSourceClickHref({ id: "src-x", type }, "ws-x"),
      ).toBe("/w/ws-x/read/src-x");
    }
  });

  it("encodes the workspace id verbatim (caller is responsible for safe ids)", () => {
    // Workspace ids come from `cuid` — no URL-unsafe chars expected. Test
    // documents that we don't double-encode.
    expect(
      buildSourceClickHref({ id: "s1", type: "pdf" }, "ws_with-dash.1"),
    ).toBe("/w/ws_with-dash.1/read/s1");
  });
});
