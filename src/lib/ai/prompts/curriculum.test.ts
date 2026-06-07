import { describe, expect, it } from "vitest";
import {
  buildCurriculumSystem,
  parseCurriculumOutput,
} from "./curriculum";

const VALID_PAYLOAD = JSON.stringify({
  title: "Quantum mechanics study path",
  goal: "Build intuition for measurement and uncertainty.",
  level: "intermediate",
  items: [
    {
      title: "Wave functions",
      objective: "Understand state representation.",
      sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_1"] }],
      prerequisites: [],
      estimatedMinutes: 45,
    },
    {
      title: "Uncertainty principle",
      objective: "Explain why position and momentum trade off.",
      sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_2"] }],
      prerequisites: ["Wave functions"],
      estimatedMinutes: 60,
    },
  ],
});

describe("buildCurriculumSystem", () => {
  it("emits rules plus cacheable workspace source inventory", () => {
    const blocks = buildCurriculumSystem({
      workspace: { name: "Physics", goal: "Pass oral exam" },
      sources: [
        {
          id: "src_1",
          title: "QM notes",
          type: "pdf",
          chunks: [
            {
              id: "ck_1",
              index: 0,
              text: "Wave functions represent quantum state.",
              section: "State vectors",
            },
          ],
        },
      ],
      locale: "en",
      level: "intermediate",
      maxItems: 6,
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.text).toContain("curriculum");
    expect(blocks[0]?.text).toContain("sourceRefs");
    expect(blocks[1]?.cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1]?.text).toContain('id="src_1"');
    expect(blocks[1]?.text).toContain("---chunk #0");
  });

  it("caps oversized source text before building the model prompt", () => {
    const huge = "A".repeat(80_000);
    const blocks = buildCurriculumSystem({
      workspace: { name: "Large workspace" },
      sources: [
        {
          id: "src_1",
          title: "Large source 1",
          type: "pdf",
          chunks: Array.from({ length: 4 }, (_, index) => ({
            id: `ck_1_${index}`,
            index,
            text: huge,
          })),
        },
        {
          id: "src_2",
          title: "Large source 2",
          type: "pdf",
          chunks: Array.from({ length: 4 }, (_, index) => ({
            id: `ck_2_${index}`,
            index,
            text: huge,
          })),
        },
      ],
      locale: "en",
    });

    const sourceBlock = blocks[1]?.text ?? "";
    expect(sourceBlock.length).toBeLessThan(140_000);
    expect(sourceBlock).toContain('id="src_1"');
    expect(sourceBlock).toContain('id="src_2"');
    expect(sourceBlock).toContain("[chunk text truncated for prompt budget]");
  });

  it("honors caller supplied source text budgets", () => {
    const huge = "A".repeat(80_000);
    const baseInput = {
      workspace: { name: "Large workspace" },
      sources: [
        {
          id: "src_1",
          title: "Large source",
          type: "pdf" as const,
          chunks: Array.from({ length: 40 }, (_, index) => ({
            id: `ck_${index}`,
            index,
            text: huge,
          })),
        },
      ],
      locale: "en" as const,
    };

    const compact = buildCurriculumSystem({
      ...baseInput,
      sourceTextBudgetChars: 40_000,
      maxChunkTextChars: 1_500,
    })[1]?.text ?? "";
    const detailed = buildCurriculumSystem({
      ...baseInput,
      sourceTextBudgetChars: 200_000,
      maxChunkTextChars: 8_000,
    })[1]?.text ?? "";

    expect(compact.length).toBeLessThan(detailed.length);
    expect(compact.length).toBeLessThan(50_000);
    expect(detailed.length).toBeGreaterThan(150_000);
  });
});

describe("parseCurriculumOutput", () => {
  it("parses a clean curriculum payload and assigns item order", () => {
    const parsed = parseCurriculumOutput(VALID_PAYLOAD);

    expect(parsed.title).toBe("Quantum mechanics study path");
    expect(parsed.level).toBe("intermediate");
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toMatchObject({
      order: 0,
      title: "Wave functions",
      status: "not_started",
      estimatedMinutes: 45,
    });
    expect(parsed.items[1]?.prerequisites).toEqual(["Wave functions"]);
  });

  it("tolerates markdown fences, leading prose, and trailing chatter", () => {
    const parsed = parseCurriculumOutput(
      "Draft:\n```json\n" + VALID_PAYLOAD + "\n```\nLooks good.",
    );

    expect(parsed.items.map((item) => item.title)).toEqual([
      "Wave functions",
      "Uncertainty principle",
    ]);
  });

  it("drops items without title, objective, or source refs", () => {
    const parsed = parseCurriculumOutput(
      JSON.stringify({
        title: "Path",
        items: [
          { title: "Good", objective: "Do it", sourceRefs: [{ sourceId: "s" }] },
          { title: "No refs", objective: "Drop", sourceRefs: [] },
          { title: "No objective", sourceRefs: [{ sourceId: "s" }] },
          { objective: "No title", sourceRefs: [{ sourceId: "s" }] },
        ],
      }),
    );

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.title).toBe("Good");
  });

  it("throws when no valid curriculum items remain", () => {
    expect(() => parseCurriculumOutput("not json")).toThrow(/no JSON/);
    expect(() =>
      parseCurriculumOutput(JSON.stringify({ title: "Empty", items: [] })),
    ).toThrow(/no valid curriculum items/);
  });
});
