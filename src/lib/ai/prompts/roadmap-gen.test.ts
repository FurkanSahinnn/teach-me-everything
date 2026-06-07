import { describe, expect, it } from "vitest";
import {
  buildRoadmapGenSystem,
  buildRoadmapGenUserMessage,
  buildRoadmapSubtaskSystem,
  buildRoadmapSubtaskUserMessage,
} from "./roadmap-gen";

describe("buildRoadmapGenSystem", () => {
  it("encodes the node budget for the timeframe", () => {
    const tr = buildRoadmapGenSystem({
      topic: "NLP",
      timeframe: "weekly",
      level: "beginner",
      locale: "tr",
    });
    const head = tr[0]?.text ?? "";
    expect(head).toMatch(/8-12 arası node/);
    expect(head).toMatch(/Çıkış SADECE JSON/);
  });

  it("emits English rules when locale=en", () => {
    const en = buildRoadmapGenSystem({
      topic: "NLP",
      timeframe: "monthly",
      level: "advanced",
      locale: "en",
    });
    const head = en[0]?.text ?? "";
    expect(head).toMatch(/16-24 nodes/);
    expect(head).toMatch(/Output ONLY JSON/);
  });

  it("appends a cached workspace-context block when sourceContext is set", () => {
    const blocks = buildRoadmapGenSystem({
      topic: "NLP",
      timeframe: "daily",
      level: "beginner",
      locale: "tr",
      sourceContext: "Concepts: tokenization, embeddings",
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[1]?.cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1]?.text).toMatch(/Concepts/);
  });

  it("omits the source-context block when sourceContext is blank", () => {
    const blocks = buildRoadmapGenSystem({
      topic: "NLP",
      timeframe: "daily",
      level: "beginner",
      locale: "tr",
      sourceContext: "   ",
    });
    expect(blocks).toHaveLength(1);
  });
});

describe("buildRoadmapGenUserMessage", () => {
  it("includes the goal line only when goal is present", () => {
    const withGoal = buildRoadmapGenUserMessage({
      topic: "NLP",
      timeframe: "weekly",
      level: "beginner",
      goal: "Sınavı geç",
      locale: "tr",
    });
    expect(withGoal).toContain("Konu: NLP");
    expect(withGoal).toContain("Hedef: Sınavı geç");

    const noGoal = buildRoadmapGenUserMessage({
      topic: "NLP",
      timeframe: "weekly",
      level: "beginner",
      locale: "en",
    });
    expect(noGoal).toBe("Topic: NLP");
  });
});

describe("buildRoadmapSubtaskSystem", () => {
  it("references the parent + roadmap context", () => {
    const blocks = buildRoadmapSubtaskSystem({
      parentTitle: "Gradient",
      parentDescription: "Türev",
      roadmapTitle: "Backprop",
      roadmapTimeframe: "weekly",
      roadmapLevel: "intermediate",
      locale: "tr",
    });
    const head = blocks[0]?.text ?? "";
    expect(head).toMatch(/3-5 adet alt-konuya/);
    expect(head).toMatch(/Backprop/);
    expect(head).toMatch(/haftalık/);
  });

  it("user message restates parent topic + description", () => {
    const msg = buildRoadmapSubtaskUserMessage({
      parentTitle: "Gradient",
      parentDescription: "Türev kavramı.",
      roadmapTitle: "Backprop",
      roadmapTimeframe: "weekly",
      roadmapLevel: "beginner",
      locale: "tr",
    });
    expect(msg).toContain("Gradient");
    expect(msg).toContain("Türev kavramı.");
  });
});
