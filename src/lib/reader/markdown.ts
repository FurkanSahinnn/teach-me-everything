export type ReaderMarkdownBlock =
  | { kind: "heading"; level: 2 | 3 | 4; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "hr" }
  | {
      kind: "table";
      headers: string[];
      align: Array<"left" | "center" | "right">;
      rows: string[][];
    };

export function parseReaderMarkdown(text: string): ReaderMarkdownBlock[] {
  const blocks: ReaderMarkdownBlock[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = (): void => {
    const body = paragraph.join("\n").trim();
    if (body) blocks.push({ kind: "paragraph", text: body });
    paragraph = [];
  };
  const flushList = (): void => {
    if (list.length > 0) blocks.push({ kind: "list", items: list });
    list = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (code) {
        blocks.push({ kind: "code", text: code.join("\n").trimEnd() });
        code = null;
      } else {
        flushParagraph();
        flushList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (isHr(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "hr" });
      continue;
    }

    const next = lines[i + 1]?.trim() ?? "";
    if (isTableRow(trimmed) && isTableSeparator(next)) {
      flushParagraph();
      flushList();
      const headers = splitTableRow(trimmed);
      const align = splitTableRow(next).map(parseAlign);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i]?.trim() ?? "")) {
        rows.push(splitTableRow(lines[i]!.trim()));
        i += 1;
      }
      i -= 1;
      blocks.push({
        kind: "table",
        headers,
        align: headers.map((_, idx) => align[idx] ?? "left"),
        rows: rows.map((row) => headers.map((_, idx) => row[idx] ?? "")),
      });
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(Math.max(heading[1]!.length, 2), 4) as 2 | 3 | 4;
      blocks.push({ kind: "heading", level, text: stripInlineMarkdown(heading[2]!) });
      continue;
    }

    const listItem = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listItem) {
      flushParagraph();
      list.push(listItem[1]!);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (code) blocks.push({ kind: "code", text: code.join("\n").trimEnd() });
  flushParagraph();
  flushList();
  return blocks;
}

export function stripMarkdownHeading(value: string): string {
  return stripInlineMarkdown(value.replace(/^#{1,6}\s+/, ""));
}

export function stripInlineMarkdown(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function isHr(value: string): boolean {
  return /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(value);
}

function isTableRow(value: string): boolean {
  return value.includes("|") && splitTableRow(value).length >= 2;
}

function isTableSeparator(value: string): boolean {
  if (!isTableRow(value)) return false;
  return splitTableRow(value).every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(value: string): string[] {
  const trimmed = value.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function parseAlign(value: string): "left" | "center" | "right" {
  const cell = value.trim();
  if (cell.startsWith(":") && cell.endsWith(":")) return "center";
  if (cell.endsWith(":")) return "right";
  return "left";
}
