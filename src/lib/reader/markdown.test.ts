import { describe, expect, it } from "vitest";
import { parseReaderMarkdown, stripMarkdownHeading } from "./markdown";

describe("parseReaderMarkdown", () => {
  it("turns headings, code fences, lists, and paragraphs into display blocks", () => {
    const blocks = parseReaderMarkdown(`# Activation

Bir noron su islemi yapar:

\`\`\`
z = w1*x1 + b
\`\`\`

## 2. Sigmoid
- Girdi ne olursa olsun
- Cikti 0 ile 1 arasinda
`);

    expect(blocks).toEqual([
      { kind: "heading", level: 2, text: "Activation" },
      { kind: "paragraph", text: "Bir noron su islemi yapar:" },
      { kind: "code", text: "z = w1*x1 + b" },
      { kind: "heading", level: 2, text: "2. Sigmoid" },
      {
        kind: "list",
        items: ["Girdi ne olursa olsun", "Cikti 0 ile 1 arasinda"],
      },
    ]);
  });

  it("turns horizontal rules and GitHub-style tables into display blocks", () => {
    const blocks = parseReaderMarkdown(`Before

---

| Name | Score | Note |
| :--- | ---: | :---: |
| Ada | 98 | **pass** |
| Linus | 87 | \`ok\` |

After`);

    expect(blocks).toEqual([
      { kind: "paragraph", text: "Before" },
      { kind: "hr" },
      {
        kind: "table",
        headers: ["Name", "Score", "Note"],
        align: ["left", "right", "center"],
        rows: [
          ["Ada", "98", "**pass**"],
          ["Linus", "87", "`ok`"],
        ],
      },
      { kind: "paragraph", text: "After" },
    ]);
  });
});

describe("stripMarkdownHeading", () => {
  it("removes heading marks and inline emphasis from outline labels", () => {
    expect(stripMarkdownHeading("### **sigmoid** kullanmak")).toBe(
      "sigmoid kullanmak",
    );
  });
});
