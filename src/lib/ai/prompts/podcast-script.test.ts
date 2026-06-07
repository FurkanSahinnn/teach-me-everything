import { describe, expect, it } from "vitest";
import {
  buildPodcastScriptSystem,
  parsePodcastScript,
  PODCAST_SCRIPT_PROMPT_VERSION,
  type PodcastPromptInput,
} from "./podcast-script";

function baseInput(): PodcastPromptInput {
  return {
    workspace: { name: "Quantum Field Theory" },
    locale: "tr",
    sources: [
      {
        id: "src_1",
        title: "Peskin §12",
        type: "pdf",
        chunks: [
          {
            id: "ck_1",
            index: 0,
            text: "Renormalization absorbs UV divergences into bare parameters.",
            section: "12.1 — Cutoff regularization",
            headings: ["Chapter 12"],
            page: 401,
          },
        ],
      },
    ],
  };
}

const VALID = JSON.stringify({
  title: "Renormalizasyon, bir diyalogda",
  titleEn: "Renormalization, in a dialogue",
  description: "İki sunucu RG akışını sezgisel hale getirir.",
  chapters: [
    { title: "Cutoff fikri", segmentIndex: 0 },
    { title: "β fonksiyonu", segmentIndex: 2 },
  ],
  segments: [
    {
      speaker: "alev",
      text: "Renormalizasyon neden gerekli aslında?",
      sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_1"] }],
    },
    {
      speaker: "deniz",
      text: "UV bölgesinde sonsuzlukları emen bir hesap aracı.",
      sourceRefs: [{ sourceId: "src_1", chunkIds: ["ck_1"] }],
    },
    {
      speaker: "alev",
      text: "Yani sabit nokta dediğin şey β = 0 olduğu yer mi?",
      sourceRefs: [],
    },
  ],
});

describe("PODCAST_SCRIPT_PROMPT_VERSION", () => {
  it("is a stable, non-empty identifier", () => {
    expect(PODCAST_SCRIPT_PROMPT_VERSION).toMatch(/^podcast-script@/);
  });
});

describe("buildPodcastScriptSystem", () => {
  it("emits a 2-block system payload with cache_control on the source payload", () => {
    const blocks = buildPodcastScriptSystem(baseInput());
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.cache_control).toBeUndefined();
    expect(blocks[1]?.cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1]?.text).toContain("<workspace_sources");
    expect(blocks[1]?.text).toContain("id=\"src_1\"");
  });

  it("uses Turkish rules when locale=tr and English when locale=en", () => {
    const tr = buildPodcastScriptSystem({ ...baseInput(), locale: "tr" });
    const en = buildPodcastScriptSystem({ ...baseInput(), locale: "en" });
    expect(tr[0]?.text).toContain("podcast diyaloğu");
    expect(en[0]?.text).toContain("two-host dialogue");
  });

  it("scales target turns with durationMin (within bounds)", () => {
    const short = buildPodcastScriptSystem({ ...baseInput(), durationMin: 5 });
    const long = buildPodcastScriptSystem({ ...baseInput(), durationMin: 60 });
    const shortText = short[0]?.text ?? "";
    const longText = long[0]?.text ?? "";
    const shortMatch = shortText.match(/~(\d+)/);
    const longMatch = longText.match(/~(\d+)/);
    expect(shortMatch).not.toBeNull();
    expect(longMatch).not.toBeNull();
    const shortTurns = Number(shortMatch?.[1] ?? 0);
    const longTurns = Number(longMatch?.[1] ?? 0);
    expect(longTurns).toBeGreaterThan(shortTurns);
  });

  it("honors a custom host name pair", () => {
    const blocks = buildPodcastScriptSystem({
      ...baseInput(),
      hosts: { alev: "Lina", deniz: "Onur" },
    });
    expect(blocks[0]?.text).toContain("Lina");
    expect(blocks[0]?.text).toContain("Onur");
  });
});

describe("parsePodcastScript", () => {
  it("parses a clean JSON envelope", () => {
    const parsed = parsePodcastScript(VALID);
    expect(parsed.title).toBe("Renormalizasyon, bir diyalogda");
    expect(parsed.titleEn).toBe("Renormalization, in a dialogue");
    expect(parsed.segments).toHaveLength(3);
    expect(parsed.segments[0]?.speaker).toBe("alev");
    expect(parsed.segments[1]?.speaker).toBe("deniz");
    expect(parsed.segments[0]?.sourceRefs[0]?.sourceId).toBe("src_1");
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0]?.segmentIndex).toBe(0);
    expect(parsed.chapters[1]?.segmentIndex).toBe(2);
  });

  it("tolerates a ```json fenced response", () => {
    const fenced = "```json\n" + VALID + "\n```";
    const parsed = parsePodcastScript(fenced);
    expect(parsed.segments).toHaveLength(3);
  });

  it("tolerates trailing prose after the closing brace", () => {
    const trailing = VALID + "\n\nNote: this script is ~30 minutes long.";
    const parsed = parsePodcastScript(trailing);
    expect(parsed.segments).toHaveLength(3);
  });

  it("drops segments with unknown speaker or empty text", () => {
    const dirty = JSON.stringify({
      title: "T",
      segments: [
        { speaker: "alev", text: "ok" },
        { speaker: "narrator", text: "stripped" },
        { speaker: "deniz", text: "" },
        { speaker: "DENIZ", text: "case-insensitive" },
      ],
    });
    const parsed = parsePodcastScript(dirty);
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments.map((s) => s.speaker)).toEqual(["alev", "deniz"]);
  });

  it("synthesises a default first chapter when the model omits chapters", () => {
    const noChapters = JSON.stringify({
      title: "T",
      segments: [
        { speaker: "alev", text: "first turn" },
        { speaker: "deniz", text: "second turn" },
      ],
    });
    const parsed = parsePodcastScript(noChapters);
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0]?.segmentIndex).toBe(0);
    expect(parsed.chapters[0]?.title).toBe("T");
  });

  it("clamps chapter segmentIndex into the valid segment range", () => {
    const bad = JSON.stringify({
      title: "T",
      chapters: [{ title: "Past the end", segmentIndex: 99 }],
      segments: [
        { speaker: "alev", text: "only turn" },
      ],
    });
    const parsed = parsePodcastScript(bad);
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0]?.segmentIndex).toBe(0);
  });

  it("rejects empty segment arrays with a parse error", () => {
    const empty = JSON.stringify({ title: "T", segments: [] });
    expect(() => parsePodcastScript(empty)).toThrow(/no valid segments/);
  });

  it("rejects non-JSON garbage", () => {
    expect(() => parsePodcastScript("not json")).toThrow(/no JSON object/);
  });

  it("de-duplicates adjacent chapters that land on the same segment", () => {
    const dup = JSON.stringify({
      title: "T",
      chapters: [
        { title: "A", segmentIndex: 0 },
        { title: "B", segmentIndex: 0 },
        { title: "C", segmentIndex: 1 },
      ],
      segments: [
        { speaker: "alev", text: "1" },
        { speaker: "deniz", text: "2" },
      ],
    });
    const parsed = parsePodcastScript(dup);
    expect(parsed.chapters.map((c) => c.title)).toEqual(["A", "C"]);
  });
});
