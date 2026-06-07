import { describe, expect, it } from "vitest";
import {
  extractFirstJsonObject,
  parseRoadmapResponse,
  parseRoadmapTranslateResponse,
  parseSubtaskResponse,
  validateRoadmapStructure,
  validateSubtaskStructure,
} from "./schema";

const happyRoadmap = {
  title: "Backprop temelleri",
  nodes: [
    { id: "n1", title: "Gradient", description: "Türev kavramı." },
    { id: "n2", title: "Chain rule", description: "Bileşik fonksiyon türevi." },
  ],
  edges: [{ from: "n1", to: "n2" }],
};

describe("extractFirstJsonObject", () => {
  it("returns null when no braces are present", () => {
    expect(extractFirstJsonObject("hello")).toBeNull();
  });

  it("strips markdown ```json fences", () => {
    const text = "```json\n{\"a\":1}\n```";
    expect(extractFirstJsonObject(text)).toBe("{\"a\":1}");
  });

  it("recovers from a chatty preamble + trailing prose", () => {
    const text = "Sure, here it is:\n{\"a\":1}\nLet me know!";
    expect(extractFirstJsonObject(text)).toBe("{\"a\":1}");
  });

  it("extracts a balanced object when a string value contains braces + trailing prose has a brace", () => {
    // The naive first-`{`/last-`}` slice grabs the trailing prose brace and
    // breaks JSON.parse; the depth/string-aware scanner stops at the matching
    // close instead.
    const text =
      'Here you go: {"title":"Use {curly} braces","nodes":[]} — hope that helps! }';
    expect(extractFirstJsonObject(text)).toBe(
      '{"title":"Use {curly} braces","nodes":[]}',
    );
  });
});

describe("parseRoadmapResponse", () => {
  it("accepts a well-formed payload", () => {
    const result = parseRoadmapResponse(JSON.stringify(happyRoadmap));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Backprop temelleri");
      expect(result.value.nodes).toHaveLength(2);
    }
  });

  it("tolerates a markdown-fenced response", () => {
    const fenced = "```json\n" + JSON.stringify(happyRoadmap) + "\n```";
    expect(parseRoadmapResponse(fenced).ok).toBe(true);
  });

  it("returns no_json when there is no JSON at all", () => {
    const result = parseRoadmapResponse("nothing here");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_json");
  });

  it("returns schema_failed on malformed JSON shape", () => {
    const result = parseRoadmapResponse('{"title":"x","nodes":[],"edges":[]}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("schema_failed");
  });

  it("returns structure_failed on self-loops", () => {
    const payload = {
      ...happyRoadmap,
      edges: [{ from: "n1", to: "n1" }],
    };
    const result = parseRoadmapResponse(JSON.stringify(payload));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("structure_failed");
  });

  it("returns structure_failed when an edge references an unknown node", () => {
    const payload = {
      ...happyRoadmap,
      edges: [{ from: "n1", to: "ghost" }],
    };
    const result = parseRoadmapResponse(JSON.stringify(payload));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("structure_failed");
  });

  it("returns structure_failed on a multi-node cycle (prerequisite-DAG contract)", () => {
    const payload = {
      title: "cyc",
      nodes: [
        { id: "n1", title: "a", description: "a" },
        { id: "n2", title: "b", description: "b" },
        { id: "n3", title: "c", description: "c" },
      ],
      edges: [
        { from: "n1", to: "n2" },
        { from: "n2", to: "n3" },
        { from: "n3", to: "n1" },
      ],
    };
    const result = parseRoadmapResponse(JSON.stringify(payload));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("structure_failed");
  });

  it("accepts a valid multi-root DAG (converging, no cycle)", () => {
    const payload = {
      title: "dag",
      nodes: [
        { id: "n1", title: "a", description: "a" },
        { id: "n2", title: "b", description: "b" },
        { id: "n3", title: "c", description: "c" },
      ],
      edges: [
        { from: "n1", to: "n3" },
        { from: "n2", to: "n3" },
      ],
    };
    expect(parseRoadmapResponse(JSON.stringify(payload)).ok).toBe(true);
  });

  it("returns structure_failed on duplicate node ids", () => {
    const payload = {
      ...happyRoadmap,
      nodes: [
        { id: "n1", title: "a", description: "a" },
        { id: "n1", title: "b", description: "b" },
      ],
    };
    const result = parseRoadmapResponse(JSON.stringify(payload));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("structure_failed");
  });
});

describe("parseSubtaskResponse", () => {
  it("accepts a well-formed subtask payload", () => {
    const payload = {
      children: [
        { id: "c1", title: "a", description: "x" },
        { id: "c2", title: "b", description: "y" },
      ],
      edges: [{ from: "c1", to: "c2" }],
    };
    const result = parseSubtaskResponse(JSON.stringify(payload));
    expect(result.ok).toBe(true);
  });

  it("rejects an empty children array", () => {
    const payload = { children: [], edges: [] };
    const result = parseSubtaskResponse(JSON.stringify(payload));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("schema_failed");
  });
});

describe("parseRoadmapTranslateResponse", () => {
  it("accepts a well-formed translation payload and preserves ids", () => {
    const payload = {
      items: [
        { id: "n1", title: "Gradient", description: "Concept of a derivative." },
        { id: "__roadmap_title__", title: "Backprop basics", description: "-" },
      ],
    };
    const result = parseRoadmapTranslateResponse(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(2);
      expect(result.value.items[0]?.id).toBe("n1");
    }
  });

  it("tolerates a markdown-fenced + chatty response", () => {
    const fenced =
      "Sure:\n```json\n" +
      JSON.stringify({ items: [{ id: "n1", title: "x", description: "y" }] }) +
      "\n```";
    expect(parseRoadmapTranslateResponse(fenced).ok).toBe(true);
  });

  it("accepts an empty items array (nothing to translate)", () => {
    expect(parseRoadmapTranslateResponse('{"items":[]}').ok).toBe(true);
  });

  it("returns no_json when there is no JSON", () => {
    const result = parseRoadmapTranslateResponse("no json here");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_json");
  });

  it("returns schema_failed when an item is missing a field", () => {
    const result = parseRoadmapTranslateResponse(
      '{"items":[{"id":"n1","title":"x"}]}',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("schema_failed");
  });
});

describe("validators (direct)", () => {
  it("validateRoadmapStructure passes the happy payload", () => {
    expect(validateRoadmapStructure(happyRoadmap)).toBeNull();
  });

  it("validateSubtaskStructure surfaces no_nodes for empty children", () => {
    expect(
      validateSubtaskStructure({ children: [], edges: [] } as never),
    ).toEqual({ kind: "no_nodes" });
  });
});
