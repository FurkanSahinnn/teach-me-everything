import { describe, expect, it } from "vitest";
import { buildLessonNoteSystem, parseLessonNoteOutput } from "./lesson-note";

const VALID = JSON.stringify({
  title: "Wave functions",
  contentMarkdown:
    "# Wave functions\n\nA wave function represents quantum state. [§ck_1]",
  sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_1"] }],
});

describe("buildLessonNoteSystem", () => {
  it("emits rules plus cacheable selected-topic source context", () => {
    const blocks = buildLessonNoteSystem({
      workspace: { name: "Physics" },
      item: {
        title: "Wave functions",
        objective: "Understand state representation.",
        sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_1"] }],
      },
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
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.text).toContain("Markdown lesson note");
    expect(blocks[0]?.text).toContain("sourceRefs");
    expect(blocks[1]?.cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1]?.text).toContain("Wave functions represent");
  });
});

describe("parseLessonNoteOutput", () => {
  it("parses a grounded Markdown note payload", () => {
    const parsed = parseLessonNoteOutput(VALID);

    expect(parsed.title).toBe("Wave functions");
    expect(parsed.contentMarkdown).toContain("[§ck_1]");
    expect(parsed.sourceRefs[0]?.sourceId).toBe("src_1");
  });

  it("tolerates markdown fences, leading prose, and trailing chatter", () => {
    const parsed = parseLessonNoteOutput(
      "Here:\n```json\n" + VALID + "\n```\nDone.",
    );

    expect(parsed.contentMarkdown).toContain("# Wave functions");
  });

  it("drops invalid source refs but keeps valid refs", () => {
    const parsed = parseLessonNoteOutput(
      JSON.stringify({
        title: "T",
        contentMarkdown: "Body [§ck_1]",
        sourceRefs: [
          { chunkIds: ["ck_missing_source"] },
          { sourceId: "src_1", chunkIds: ["ck_1"] },
        ],
      }),
    );

    expect(parsed.sourceRefs).toEqual([{ sourceId: "src_1", chunkIds: ["ck_1"] }]);
  });

  it("throws when note body or valid source refs are missing", () => {
    expect(() => parseLessonNoteOutput("not json")).toThrow(/no JSON/);
    expect(() =>
      parseLessonNoteOutput(
        JSON.stringify({ title: "T", contentMarkdown: "Body", sourceRefs: [] }),
      ),
    ).toThrow(/sourceRefs/);
    expect(() =>
      parseLessonNoteOutput(
        JSON.stringify({ title: "T", contentMarkdown: "", sourceRefs: [{ sourceId: "s" }] }),
      ),
    ).toThrow(/contentMarkdown/);
  });
});
