import { describe, expect, it } from "vitest";
import {
  buildWorkspaceChatSystem,
  type WorkspaceChatSystemInput,
} from "./workspace-chat";

function baseInput(
  overrides: Partial<WorkspaceChatSystemInput> = {},
): WorkspaceChatSystemInput {
  return {
    locale: "tr",
    sources: [
      {
        id: "src-1",
        title: "Kuantum Mekaniği",
        titleEn: "Quantum Mechanics",
        author: "Dirac",
        type: "pdf",
        chunks: [
          {
            index: 3,
            section: "2.3 Süperpozisyon",
            text: "Süperpozisyon ilkesi…",
            page: 12,
          },
          {
            index: 4,
            headings: ["Ölçüm"],
            text: "Ölçüm sonrası çöküş…",
          },
        ],
      },
    ],
    contextBlocks: [],
    ...overrides,
  };
}

describe("buildWorkspaceChatSystem", () => {
  it("emits a rules block followed by the sources block, only the sources block cached", () => {
    const blocks = buildWorkspaceChatSystem(baseInput());
    expect(blocks).toHaveLength(2);

    const [rules, sources] = blocks;
    expect(rules?.cache_control).toBeUndefined();
    expect(sources?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("wraps all sources in a single <sources> block with per-source id/title/type and per-chunk src tags", () => {
    const blocks = buildWorkspaceChatSystem(baseInput());
    const sources = blocks[1]?.text ?? "";

    expect(sources).toContain("<sources>");
    expect(sources).toContain("</sources>");
    expect(sources).toContain('<source id="src-1" title="Kuantum Mekaniği"');
    expect(sources).toContain('author="Dirac"');
    expect(sources).toContain('type="pdf"');
    // each chunk is tagged with its source id + section + page
    expect(sources).toContain("src: src-1");
    expect(sources).toContain("section: 2.3 Süperpozisyon");
    expect(sources).toContain("page: 12");
    // headings[0] is used as the section when section is absent
    expect(sources).toContain("section: Ölçüm");
  });

  it("uses titleEn for the source wrapper when locale is en", () => {
    const blocks = buildWorkspaceChatSystem(baseInput({ locale: "en" }));
    const sources = blocks[1]?.text ?? "";
    expect(sources).toContain('title="Quantum Mechanics"');
    expect(sources).not.toContain('title="Kuantum Mekaniği"');
  });

  it("concatenates multiple sources into the same cached block", () => {
    const input = baseInput({
      sources: [
        { id: "a", title: "A", type: "pdf", chunks: [{ index: 0, text: "aa" }] },
        { id: "b", title: "B", type: "url", chunks: [{ index: 0, text: "bb" }] },
      ],
    });
    const blocks = buildWorkspaceChatSystem(input);
    expect(blocks).toHaveLength(2);
    const sources = blocks[1]?.text ?? "";
    expect(sources).toContain('id="a"');
    expect(sources).toContain('id="b"');
    expect(blocks[1]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("appends context blocks AFTER the cached sources block, uncached, with a locale heading", () => {
    const input = baseInput({
      contextBlocks: [
        { kind: "notes", text: "Not 1 özeti" },
        { kind: "performance", text: "Zayıf konu: integral" },
      ],
    });
    const blocks = buildWorkspaceChatSystem(input);
    expect(blocks).toHaveLength(4); // rules + sources + 2 context

    const [, sources, notes, perf] = blocks;
    expect(sources?.cache_control).toEqual({ type: "ephemeral" });
    // context blocks must NOT be cached (they change more often than corpus)
    expect(notes?.cache_control).toBeUndefined();
    expect(perf?.cache_control).toBeUndefined();
    // TR headings + payload
    expect(notes?.text).toContain("ÇALIŞMA ALANI NOTLARI");
    expect(notes?.text).toContain("Not 1 özeti");
    expect(perf?.text).toContain("ÖĞRENME PERFORMANSI");
    expect(perf?.text).toContain("Zayıf konu: integral");
  });

  it("uses English context headings when locale is en", () => {
    const input = baseInput({
      locale: "en",
      contextBlocks: [
        { kind: "concepts", text: "graph" },
        { kind: "roadmap", text: "nodes" },
      ],
    });
    const blocks = buildWorkspaceChatSystem(input);
    expect(blocks[2]?.text).toContain("CONCEPT MAP");
    expect(blocks[3]?.text).toContain("ROADMAP");
  });

  it("embeds the hybrid grounding rule + multi-source citation format in TR", () => {
    const rules = buildWorkspaceChatSystem(baseInput()).at(0)?.text ?? "";
    // hybrid grounding: general knowledge allowed but must be flagged
    expect(rules).toContain("Kaynaklarında bu yok — genel bilgiyle:");
    expect(rules).toContain("ASLA çelişme");
    // multi-source citation marker
    expect(rules).toContain("[§<kaynak-başlığı> · <bölüm>]");
  });

  it("embeds the hybrid grounding rule + multi-source citation format in EN", () => {
    const rules =
      buildWorkspaceChatSystem(baseInput({ locale: "en" })).at(0)?.text ?? "";
    expect(rules).toContain("from general knowledge:");
    expect(rules).toContain("NEVER contradict the sources");
    expect(rules).toContain("[§<source-title> · <section>]");
  });

  it("forces the response locale when aiResponseLocale is explicit", () => {
    const trForced =
      buildWorkspaceChatSystem(
        baseInput({ aiResponseLocale: "tr" }),
      ).at(0)?.text ?? "";
    expect(trForced).toContain("Yanıtını mutlaka Türkçe ver");

    const enForced =
      buildWorkspaceChatSystem(
        baseInput({ locale: "en", aiResponseLocale: "en" }),
      ).at(0)?.text ?? "";
    expect(enForced).toContain("Always respond in English");
  });

  it("does not append a locale directive when aiResponseLocale follows source / is omitted", () => {
    const followed =
      buildWorkspaceChatSystem(
        baseInput({ aiResponseLocale: "follow_source" }),
      ).at(0)?.text ?? "";
    expect(followed).not.toContain("mutlaka");
    expect(followed).not.toContain("Always respond");
  });

  it("emits an empty <sources></sources> block when the workspace has no sources", () => {
    const blocks = buildWorkspaceChatSystem(baseInput({ sources: [] }));
    expect(blocks).toHaveLength(2);
    expect(blocks[1]?.text).toBe("<sources></sources>");
    expect(blocks[1]?.cache_control).toEqual({ type: "ephemeral" });
  });
});
