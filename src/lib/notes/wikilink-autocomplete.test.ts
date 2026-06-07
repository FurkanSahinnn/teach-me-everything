import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { buildWikilinkLookups } from "./wikilink-resolver";
import { makeWikilinkSource } from "./wikilink-autocomplete";

const LOOKUPS = buildWikilinkLookups({
  notes: [
    { id: "n1", title: "Quantum Mechanics", updatedAt: 200 },
    { id: "n2", title: "Quantum Field Theory", updatedAt: 100 },
    { id: "n3", title: "Linear Algebra", updatedAt: 50 },
  ],
  sources: [{ id: "src_abc", title: "P&S" }],
  concepts: [{ id: "cpt_x", name: "Renormalization" }],
});

function makeContext(doc: string, pos: number, explicit = false): CompletionContext {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos, explicit);
}

describe("makeWikilinkSource", () => {
  const source = makeWikilinkSource({ getLookups: () => LOOKUPS });

  it("returns null when the cursor is not after `[[`", () => {
    const ctx = makeContext("hello", 5);
    expect(source(ctx)).toBeNull();
  });

  it("returns a result when `[[` is just before the cursor", () => {
    const ctx = makeContext("note: [[", 8);
    const result = source(ctx);
    expect(result).not.toBeNull();
    // `from` should land right after the `[[`.
    expect(result?.from).toBe(8);
    // Empty query returns everything.
    expect(result?.options.length).toBeGreaterThan(0);
  });

  it("matches the partial query inside `[[`", () => {
    const ctx = makeContext("see [[Quan", 10);
    const result = source(ctx);
    expect(result).not.toBeNull();
    // First option should be a Quantum* note (best score).
    expect(result?.options[0]?.label).toMatch(/^Quantum/);
  });

  it("filters by `source:` kind prefix", () => {
    const ctx = makeContext("[[source:", 9);
    const result = source(ctx);
    expect(result).not.toBeNull();
    expect(result?.options.every((o) => o.type === "source")).toBe(true);
  });

  it("filters by `concept:` kind prefix", () => {
    const ctx = makeContext("[[concept:Renorm", 16);
    const result = source(ctx);
    expect(result).not.toBeNull();
    expect(result?.options[0]?.type).toBe("concept");
  });

  it("returns null when the bracket scope was already closed", () => {
    // Cursor after the closing `]]` — no longer "inside" a wikilink.
    const ctx = makeContext("[[Quan]] tail", 13);
    expect(source(ctx)).toBeNull();
  });

  it("returns null when the lookups provider returns null", () => {
    const offlineSource = makeWikilinkSource({ getLookups: () => null });
    const ctx = makeContext("[[Quan", 6);
    expect(offlineSource(ctx)).toBeNull();
  });

  it("respects the limit option", () => {
    const limited = makeWikilinkSource({ getLookups: () => LOOKUPS, limit: 1 });
    const ctx = makeContext("[[", 2);
    const result = limited(ctx);
    expect(result?.options.length).toBe(1);
  });

  it("disables CM6's built-in fuzzy filter (we pre-rank)", () => {
    const ctx = makeContext("[[Quan", 6);
    const result = source(ctx);
    expect(result?.filter).toBe(false);
  });
});
