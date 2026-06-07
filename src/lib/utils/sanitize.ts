import DOMPurify, { type Config } from "isomorphic-dompurify";

const ALLOWED_TAGS = [
  "a", "abbr", "b", "blockquote", "br", "code", "del", "em",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "i", "img", "ins", "kbd", "li", "ol", "p", "pre",
  "s", "small", "span", "strong", "sub", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr",
  "u", "ul",
];

const ALLOWED_ATTR = [
  "href", "title", "target", "rel",
  "alt", "src", "loading",
  "class", "id", "lang", "dir",
  "colspan", "rowspan", "scope",
  "data-citation", "data-source-id", "data-chunk-id",
];

const SAFE_URI = /^(?:(?:https?|mailto|tel):|#|\/(?!\/))/i;

const BASE_CONFIG: Config = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOW_DATA_ATTR: true,
  ALLOWED_URI_REGEXP: SAFE_URI,
  FORBID_ATTR: ["style", "onerror", "onload"],
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
  KEEP_CONTENT: true,
};

let hookInstalled = false;
function ensureHook(): void {
  if (hookInstalled) return;
  if (typeof DOMPurify.addHook !== "function") return;
  DOMPurify.addHook("afterSanitizeAttributes", (node: Node) => {
    if (!(node instanceof Element)) return;
    if (node.tagName === "A") {
      const href = node.getAttribute("href");
      if (href && /^https?:\/\//i.test(href)) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    }
    if (node.tagName === "IMG") {
      if (!node.getAttribute("loading")) {
        node.setAttribute("loading", "lazy");
      }
    }
  });
  hookInstalled = true;
}

export function sanitizeHtml(html: string, overrides?: Config): string {
  ensureHook();
  const config: Config = { ...BASE_CONFIG, ...(overrides ?? {}) };
  return String(DOMPurify.sanitize(html, config));
}

export function stripHtml(html: string): string {
  return String(
    DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [], KEEP_CONTENT: true }),
  );
}
