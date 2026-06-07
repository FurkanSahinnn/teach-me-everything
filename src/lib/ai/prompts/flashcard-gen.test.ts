import { describe, expect, it } from "vitest";
import {
  buildFlashcardGenSystem,
  clampCount,
  dedupeFlashcardCards,
  parseFlashcardGenOutput,
  type FlashcardGenCard,
} from "./flashcard-gen";

const CARD_A = { question: "Q1", answer: "A1" };
const CARD_B = { question: "Q2", answer: "A2", tags: ["sample"] };

describe("parseFlashcardGenOutput", () => {
  it("parses a plain JSON `{cards: [...]}` payload", () => {
    const json = JSON.stringify({ cards: [CARD_A, CARD_B] });
    const out = parseFlashcardGenOutput(json);
    expect(out.cards).toHaveLength(2);
    expect(out.cards[0]).toEqual(CARD_A);
    expect(out.cards[1]).toMatchObject({ question: "Q2", tags: ["sample"] });
  });

  it("strips a leading ```json markdown fence", () => {
    const wrapped = "```json\n" + JSON.stringify({ cards: [CARD_A] }) + "\n```";
    const out = parseFlashcardGenOutput(wrapped);
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0]?.question).toBe("Q1");
  });

  it("tolerates a leading prose preamble before the JSON", () => {
    const raw =
      "Sure! Here is the JSON you asked for:\n\n" +
      JSON.stringify({ cards: [CARD_A, CARD_B] });
    const out = parseFlashcardGenOutput(raw);
    expect(out.cards).toHaveLength(2);
  });

  it("accepts a bare array (no `cards` wrapper)", () => {
    const json = JSON.stringify([CARD_A, CARD_B]);
    const out = parseFlashcardGenOutput(json);
    expect(out.cards).toHaveLength(2);
  });

  it("filters cards that are missing question or answer", () => {
    const json = JSON.stringify({
      cards: [
        CARD_A,
        { question: "" }, // missing answer
        { answer: "lone answer" }, // missing question
        { question: "  ", answer: "whitespace q" },
        CARD_B,
      ],
    });
    const out = parseFlashcardGenOutput(json);
    expect(out.cards).toHaveLength(2);
    expect(out.cards.map((c) => c.question)).toEqual(["Q1", "Q2"]);
  });

  it("throws when the response contains no JSON object", () => {
    expect(() => parseFlashcardGenOutput("just some plain text")).toThrow(
      /no JSON object/i,
    );
  });
});

describe("dedupeFlashcardCards", () => {
  it("removes identical questions, keeping the first occurrence", () => {
    const dup: FlashcardGenCard[] = [
      { question: "What is X?", answer: "first" },
      { question: "What is X?", answer: "second" },
      { question: "What is Y?", answer: "y" },
    ];
    const out = dedupeFlashcardCards(dup);
    expect(out).toHaveLength(2);
    expect(out[0]?.answer).toBe("first");
    expect(out[1]?.question).toBe("What is Y?");
  });

  it("normalizes case and punctuation when comparing", () => {
    const dup: FlashcardGenCard[] = [
      { question: "Define entropy.", answer: "a" },
      { question: "DEFINE ENTROPY?", answer: "b" },
      { question: "  define   entropy ", answer: "c" },
    ];
    const out = dedupeFlashcardCards(dup);
    expect(out).toHaveLength(1);
    expect(out[0]?.answer).toBe("a");
  });

  it("collapses internal whitespace", () => {
    const dup: FlashcardGenCard[] = [
      { question: "Hilbert\tspace?", answer: "1" },
      { question: "Hilbert  space?", answer: "2" },
      { question: "Banach space?", answer: "3" },
    ];
    const out = dedupeFlashcardCards(dup);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.answer)).toEqual(["1", "3"]);
  });

  it("returns an empty array for empty input", () => {
    expect(dedupeFlashcardCards([])).toEqual([]);
  });
});

describe("clampCount + buildFlashcardGenSystem (smoke)", () => {
  it("clamps card count to [1, 20]", () => {
    expect(clampCount(0)).toBe(1);
    expect(clampCount(50)).toBe(20);
    expect(clampCount(7.6)).toBe(8); // rounds
    expect(clampCount(Number.NaN)).toBe(1);
  });

  it("emits a system block with cache_control on the source payload", () => {
    const blocks = buildFlashcardGenSystem({
      source: { title: "QFT", type: "pdf" },
      chunks: [
        { index: 0, section: "Intro", text: "ground state energy", page: 1 },
      ],
      locale: "en",
      count: 5,
      mode: "batch",
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.text).toContain("Output format");
    expect(blocks[1]?.cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1]?.text).toContain("ground state energy");
  });

  it("appends a Chat-context block only when mode === 'single' and chatContext is set", () => {
    const base = {
      source: { title: "QFT", type: "pdf" as const },
      chunks: [{ index: 0, text: "free field theory", page: 1 }],
      locale: "en" as const,
      count: 5,
    };
    // single + chatContext → 3 blocks (rules, source, context)
    const withCtx = buildFlashcardGenSystem({
      ...base,
      mode: "single",
      chatContext: "User: what is φ⁴?\nAssistant: a quartic interaction term.",
    });
    expect(withCtx).toHaveLength(3);
    expect(withCtx[2]?.text).toContain("Chat context");
    expect(withCtx[2]?.text).toContain("quartic interaction");
    // single without chatContext → 2 blocks (skip the context block)
    const noCtx = buildFlashcardGenSystem({ ...base, mode: "single" });
    expect(noCtx).toHaveLength(2);
    // batch + chatContext → still 2 blocks (context ignored in batch mode)
    const batch = buildFlashcardGenSystem({
      ...base,
      mode: "batch",
      chatContext: "ignored",
    });
    expect(batch).toHaveLength(2);
  });
});
