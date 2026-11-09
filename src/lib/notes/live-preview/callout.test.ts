import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  calloutField,
  calloutFamily,
  defaultCalloutTitle,
  findQuoteBlocks,
  parseCalloutHeader,
  quotePrefixLength,
  toggleCalloutFold,
} from "./callout";

describe("parseCalloutHeader", () => {
  it("parses type, fold and title", () => {
    expect(parseCalloutHeader("[!Warning]- Careful now")).toMatchObject({
      type: "warning",
      fold: "-",
      title: "Careful now",
    });
  });
  it("accepts a bare header", () => {
    expect(parseCalloutHeader("[!note]")).toMatchObject({ type: "note", fold: null, title: "" });
  });
  it("rejects normal text", () => {
    expect(parseCalloutHeader("hello [!note]")).toBeNull();
  });
});

describe("callout helpers", () => {
  it("maps families", () => {
    expect(calloutFamily("tip")).toBe("ok");
    expect(calloutFamily("BUG")).toBe("err");
    expect(calloutFamily("unknown")).toBe("accent");
  });
  it("capitalises default titles", () => {
    expect(defaultCalloutTitle("note")).toBe("Note");
    expect(defaultCalloutTitle("my-type")).toBe("My type");
  });
  it("measures quote prefixes", () => {
    expect(quotePrefixLength("> a")).toBe(2);
    expect(quotePrefixLength(">> a")).toBe(3);
    expect(quotePrefixLength("a > b")).toBe(0);
  });
});

describe("findQuoteBlocks", () => {
  it("groups consecutive quote lines and detects callouts", () => {
    const blocks = findQuoteBlocks(["> [!tip] Hi", "> body", "", "> plain", "text"]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ fromLine: 1, toLine: 2 });
    expect(blocks[0]!.callout?.type).toBe("tip");
    expect(blocks[1]).toMatchObject({ fromLine: 4, toLine: 4, callout: null });
  });
  it("ignores quotes inside fenced code", () => {
    expect(findQuoteBlocks(["```", "> x", "```"])).toEqual([]);
  });
});

describe("calloutField", () => {
  const doc = "> [!note]- Folded\n> body\n> more\n\nafter";
  it("starts collapsed for `-` and toggles", () => {
    let state = EditorState.create({ doc: "x\n" + doc, extensions: [calloutField], selection: { anchor: 0 } });
    expect(state.field(calloutField).decos.size).toBe(1);
    state = state.update({ effects: toggleCalloutFold.of(2) }).state;
    expect(state.field(calloutField).decos.size).toBe(0);
  });
  it("stays open while the cursor is inside", () => {
    const state = EditorState.create({ doc, extensions: [calloutField], selection: { anchor: 20 } });
    expect(state.field(calloutField).decos.size).toBe(0);
  });
});
