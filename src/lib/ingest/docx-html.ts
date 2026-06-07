// Pure transform: HTML produced by mammoth → ChunkerPage[]. Lives in its own
// module so it is safe to import from main thread, tests (jsdom), and the
// docx-worker without dragging mammoth's full bundle into the main chunk.

import type { ChunkerPage } from "./chunker";

export function htmlToPages(html: string): ChunkerPage[] {
  if (!html.trim()) return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;
  if (!body) return [];

  const pages: ChunkerPage[] = [];
  let currentText: string[] = [];
  let currentHeadings: string[] = [];
  let pageNum = 1;

  function flush(): void {
    const text = currentText.join("\n").trim();
    if (!text) {
      currentText = [];
      currentHeadings = [];
      return;
    }
    const page: ChunkerPage = { page: pageNum, text };
    if (currentHeadings.length > 0) page.headings = [...currentHeadings];
    pages.push(page);
    pageNum += 1;
    currentText = [];
    currentHeadings = [];
  }

  // Walk only the immediate children. Mammoth emits a flat structure of
  // <h1>/<h2>/.../<p>/<ul>/<ol>/<table>/etc., so recursion isn't needed.
  for (const node of Array.from(body.childNodes)) {
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === "h1") {
      // h1 starts a new logical "page" so its text + descendants stay grouped.
      if (currentText.length > 0) flush();
      const t = (el.textContent ?? "").trim();
      if (t) {
        currentHeadings.push(t);
        currentText.push(t);
      }
      continue;
    }

    if (tag === "h2" || tag === "h3" || tag === "h4") {
      const t = (el.textContent ?? "").trim();
      if (t) {
        currentHeadings.push(t);
        currentText.push(t);
      }
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      for (const li of Array.from(el.querySelectorAll("li"))) {
        const t = (li.textContent ?? "").trim();
        if (t) currentText.push(`- ${t}`);
      }
      continue;
    }

    if (tag === "table") {
      for (const row of Array.from(el.querySelectorAll("tr"))) {
        const cells = Array.from(row.querySelectorAll("th, td"))
          .map((c) => (c.textContent ?? "").trim())
          .filter(Boolean);
        if (cells.length > 0) currentText.push(cells.join(" | "));
      }
      continue;
    }

    // p, blockquote, pre, default
    const t = (el.textContent ?? "").trim();
    if (t) currentText.push(t);
  }

  if (currentText.length > 0) flush();
  return pages;
}
