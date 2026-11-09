import { describe, expect, it } from "vitest";
import { parseTable, splitTableRow, tokenizeInline } from "./table-widget";

describe("splitTableRow", () => {
  it("trims cells and records offsets", () => {
    expect(splitTableRow("| a | b |")).toEqual([
      { text: "a", offset: 2 },
      { text: "b", offset: 6 },
    ]);
  });
  it("keeps escaped pipes and pipes in code inside the cell", () => {
    const cells = splitTableRow("| a\\|b | `x|y` |");
    expect(cells.map((c) => c.text)).toEqual(["a\\|b", "`x|y`"]);
  });
});

describe("parseTable", () => {
  it("reads alignment from the delimiter row", () => {
    const t = parseTable("| h1 | h2 | h3 |\n| :- | :-: | -: |\n| a | b | c |")!;
    expect(t.align).toEqual(["left", "center", "right"]);
    expect(t.header.map((c) => c.text)).toEqual(["h1", "h2", "h3"]);
    expect(t.rows).toHaveLength(1);
  });
  it("rejects a missing delimiter row", () => {
    expect(parseTable("| a |\n| b |")).toBeNull();
  });
});

describe("tokenizeInline", () => {
  it("handles bold, italic, code and links", () => {
    const kinds = tokenizeInline("**b** *i* `c` [t](u) x").map((t) => t.kind);
    expect(kinds).toEqual(["strong", "text", "em", "text", "code", "text", "link", "text"]);
  });
  it("leaves html as text", () => {
    expect(tokenizeInline("<b>x</b>")).toEqual([{ kind: "text", text: "<b>x</b>" }]);
  });
});
