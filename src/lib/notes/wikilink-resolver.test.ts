import { describe, expect, it } from "vitest";
import {
  buildWikilinkLookups,
  buildWikilinkSuggestions,
  resolveWikilink,
} from "./wikilink-resolver";

const NOTES = [
  { id: "n1", title: "Quantum Field Theory", updatedAt: 300 },
  { id: "n2", title: "Quantum Mechanics", updatedAt: 200 },
  { id: "n3", title: "Reading Notes 2026", updatedAt: 100 },
  { id: "n4", title: "Quantum Field Theory", updatedAt: 400 }, // dup, newer
];
const SOURCES = [
  { id: "src_abc12345", title: "Peskin-Schroeder" },
  { id: "src_qed987", title: "QED Notes" },
];
const CONCEPTS = [
  { id: "cpt_renorm", name: "Renormalization" },
  { id: "cpt_gauge", name: "Gauge Invariance" },
];

const LOOKUPS = buildWikilinkLookups({
  notes: NOTES,
  sources: SOURCES,
  concepts: CONCEPTS,
});

describe("buildWikilinkLookups", () => {
  it("deduplicates notes by title, preferring the newer updatedAt", () => {
    const hit = LOOKUPS.noteByTitle.get("quantum field theory");
    expect(hit).toBeDefined();
    expect(hit?.id).toBe("n4");
  });

  it("skips notes with empty title", () => {
    const ls = buildWikilinkLookups({
      notes: [{ id: "x", title: "", updatedAt: 1 }],
      sources: [],
      concepts: [],
    });
    expect(ls.noteByTitle.size).toBe(0);
  });
});

describe("resolveWikilink", () => {
  it("resolves a known note title case-insensitively", () => {
    const r = resolveWikilink(
      { target: "quantum mechanics", kind: "note" },
      LOOKUPS,
    );
    expect(r.exists).toBe(true);
    expect(r.id).toBe("n2");
    expect(r.label).toBe("Quantum Mechanics");
  });

  it("returns exists: false for an unknown note", () => {
    const r = resolveWikilink(
      { target: "Nope", kind: "note" },
      LOOKUPS,
    );
    expect(r.exists).toBe(false);
    expect(r.id).toBeNull();
    expect(r.label).toBe("Nope");
  });

  it("uses alias as label when present even for an unknown target", () => {
    const r = resolveWikilink(
      { target: "Nope", kind: "note", alias: "click me" },
      LOOKUPS,
    );
    expect(r.label).toBe("click me");
  });

  it("resolves a source by id and falls back to alias label", () => {
    const r = resolveWikilink(
      { target: "src_abc12345", kind: "source", alias: "P&S" },
      LOOKUPS,
    );
    expect(r.exists).toBe(true);
    expect(r.id).toBe("src_abc12345");
    expect(r.label).toBe("P&S");
  });

  it("resolves a source by id with the source's title as label when no alias", () => {
    const r = resolveWikilink(
      { target: "src_qed987", kind: "source" },
      LOOKUPS,
    );
    expect(r.label).toBe("QED Notes");
  });

  it("resolves a concept by id with the concept's name as label", () => {
    const r = resolveWikilink(
      { target: "cpt_renorm", kind: "concept" },
      LOOKUPS,
    );
    expect(r.exists).toBe(true);
    expect(r.label).toBe("Renormalization");
  });

  it("returns exists: false for unknown source / concept ids", () => {
    expect(
      resolveWikilink({ target: "src_missing", kind: "source" }, LOOKUPS).exists,
    ).toBe(false);
    expect(
      resolveWikilink({ target: "cpt_missing", kind: "concept" }, LOOKUPS).exists,
    ).toBe(false);
  });
});

describe("buildWikilinkSuggestions", () => {
  it("returns all entities when query is empty (limit applied)", () => {
    const out = buildWikilinkSuggestions("", LOOKUPS, 50);
    // 3 unique notes + 2 sources + 2 concepts
    expect(out.length).toBe(7);
  });

  it("respects the limit parameter", () => {
    const out = buildWikilinkSuggestions("", LOOKUPS, 2);
    expect(out.length).toBe(2);
  });

  it("ranks exact matches above prefix matches", () => {
    const out = buildWikilinkSuggestions("Quantum Mechanics", LOOKUPS);
    expect(out[0]?.label).toBe("Quantum Mechanics");
  });

  it("ranks prefix above substring", () => {
    const out = buildWikilinkSuggestions("quan", LOOKUPS);
    expect(out[0]?.kind).toBe("note");
    expect(out[0]?.label).toMatch(/^Quantum /);
  });

  it("returns word-prefix matches (Reading Notes → 'not')", () => {
    const out = buildWikilinkSuggestions("not", LOOKUPS);
    const titles = out.map((s) => s.label);
    expect(titles).toContain("Reading Notes 2026");
  });

  it("filters by kind prefix `source:`", () => {
    const out = buildWikilinkSuggestions("source:qed", LOOKUPS);
    expect(out.every((s) => s.kind === "source")).toBe(true);
    expect(out[0]?.id).toBe("src_qed987");
  });

  it("filters by kind prefix `concept:`", () => {
    const out = buildWikilinkSuggestions("concept:gauge", LOOKUPS);
    expect(out.every((s) => s.kind === "concept")).toBe(true);
    expect(out[0]?.id).toBe("cpt_gauge");
  });

  it("inserts a plain title for notes, prefixed id for sources/concepts", () => {
    const notes = buildWikilinkSuggestions("Quantum Mechanics", LOOKUPS, 1);
    expect(notes[0]?.insertText).toBe("Quantum Mechanics");

    const src = buildWikilinkSuggestions("source:qed", LOOKUPS, 1);
    expect(src[0]?.insertText).toBe("source:src_qed987");

    const cpt = buildWikilinkSuggestions("concept:gauge", LOOKUPS, 1);
    expect(cpt[0]?.insertText).toBe("concept:cpt_gauge");
  });

  it("returns nothing for a non-matching query", () => {
    const out = buildWikilinkSuggestions("xyzzy123", LOOKUPS);
    expect(out).toEqual([]);
  });

  it("matches sources by their id as well as their title", () => {
    const out = buildWikilinkSuggestions("abc1234", LOOKUPS);
    expect(out.some((s) => s.id === "src_abc12345")).toBe(true);
  });
});
