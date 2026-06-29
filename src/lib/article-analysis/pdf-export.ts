import type {
  AnalysisClaim,
  ArticleAnalysisRecord,
} from "@/lib/article-analysis/types";

// Self-contained PDF export for an Article Analysis. Mirrors the approach in
// src/lib/study/pdf-export.ts (themed HTML → html2pdf.js) but builds the body
// straight from the structured ArticleAnalysisPayload rather than markdown, so
// the layered sections, grounding flags, citations and the bilingual glossary
// keep their structure on the page. Kept independent of the study module to
// avoid coupling two features through a shared private util.

export type PdfTheme = "white" | "sepia" | "dark";

const THEME_VARS: Record<PdfTheme, Record<string, string>> = {
  // Neutral black-on-white print palette (NOT the app's warm "white" theme):
  // the PDF must read as a printed document regardless of the UI theme, so
  // text is near-black / neutral gray and the background is pure white. The
  // accent stays a dark muted gold for decorative borders / citation marks /
  // the [G] badge — all readable on white.
  white: {
    bg: "#ffffff",
    ink: "#111111",
    "ink-2": "#2b2b2b",
    "ink-3": "#555555",
    "ink-4": "#7a7a7a",
    accent: "#8a6d2f",
    ok: "#3f7a3f",
    rule: "#dddddd",
    wash: "#f3f3f3",
  },
  sepia: {
    bg: "#f4ecd8",
    ink: "#2a2418",
    "ink-2": "#3f3a2a",
    "ink-3": "#6b6346",
    "ink-4": "#8e8769",
    accent: "#8b6914",
    ok: "#4e7d4e",
    rule: "#d8c8a3",
    wash: "#ebe1c8",
  },
  dark: {
    bg: "#1c1a17",
    ink: "#ebe6d8",
    "ink-2": "#bcb4a0",
    "ink-3": "#8a8472",
    "ink-4": "#5e5b50",
    accent: "#d4a85a",
    ok: "#7fae6e",
    rule: "#3a342a",
    wash: "#25221d",
  },
};

const STYLE_RULES = `
@page { size: A4; margin: 18mm 16mm; }
.tme-an {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ink); background: var(--bg);
  font-size: 10.5pt; line-height: 1.5; padding: 14pt 0 10pt;
}
.tme-an h1 {
  font-family: "Source Serif 4", Georgia, serif;
  font-size: 21pt; font-weight: 600; margin: 0 0 4pt; letter-spacing: -0.01em;
}
.tme-an h2 {
  font-family: "Source Serif 4", Georgia, serif;
  font-size: 14pt; font-weight: 600; margin: 16pt 0 5pt;
  padding-bottom: 2pt; border-bottom: 1px solid var(--rule);
  page-break-after: avoid;
}
.tme-an h3 { font-size: 11.5pt; font-weight: 600; margin: 10pt 0 3pt; page-break-after: avoid; }
.tme-an p { margin: 4pt 0; }
.tme-an ul, .tme-an ol { margin: 4pt 0; padding-left: 16pt; }
.tme-an li { margin: 3pt 0; page-break-inside: avoid; }
.tme-an .lede { font-size: 11.5pt; color: var(--ink); margin: 2pt 0 8pt; }
.tme-an .meta {
  font-family: ui-monospace, monospace; font-size: 8.5pt; color: var(--ink-3);
  border-bottom: 1px solid var(--rule); padding-bottom: 6pt; margin: 2pt 0 12pt;
  display: flex; flex-wrap: wrap; gap: 3pt 14pt;
}
.tme-an .meta b { color: var(--ink-2); font-weight: 600; }
.tme-an .draft {
  border: 1px solid var(--accent); background: var(--wash); color: var(--ink-2);
  border-radius: 4px; padding: 6pt 9pt; margin: 0 0 12pt; font-size: 9.5pt;
}
.tme-an dl.glance { margin: 4pt 0; display: grid; grid-template-columns: max-content 1fr; gap: 2pt 10pt; }
.tme-an dl.glance dt { color: var(--ink-3); font-weight: 600; font-size: 9.5pt; }
.tme-an dl.glance dd { margin: 0; }
.tme-an .src { color: var(--ink-3); font-style: italic; }
.tme-an .quote { color: var(--ink-3); }
.tme-an .gen {
  font-size: 0.8em; color: var(--accent); border: 1px solid var(--accent);
  border-radius: 3px; padding: 0 0.3em; margin-left: 0.3em; white-space: nowrap;
}
.tme-an .why { color: var(--ink-3); }
.tme-an .weakest { color: var(--accent); font-weight: 600; }
.tme-an table.gloss { border-collapse: collapse; width: 100%; margin: 6pt 0; page-break-inside: auto; }
.tme-an table.gloss th, .tme-an table.gloss td {
  border: 1px solid var(--rule); padding: 3pt 6pt; text-align: left; vertical-align: top; font-size: 9.5pt;
}
.tme-an table.gloss th { background: var(--wash); font-weight: 600; }
.tme-an table.gloss tr { page-break-inside: avoid; }
.tme-an .term { font-weight: 600; }
.tme-an section { page-break-inside: auto; }
`;

const L = {
  tr: {
    tldr: "Özet",
    glance: "Bir bakışta",
    fiveCs: "5 C değerlendirmesi",
    problem: "Problem ve motivasyon",
    prior: "Önceki çalışmalar ve boşluk",
    contributions: "Katkılar",
    keyIdea: "Ana fikir (sade anlatım)",
    method: "Yöntem adım adım",
    howSolves: "Problemi nasıl çözüyor",
    results: "Sonuçlar ve kanıt",
    critique: "Eleştirel değerlendirme (hakem gözü)",
    weakest: "En zayıf nokta",
    limitations: "Varsayımlar, kısıtlar ve geçerlilik tehditleri",
    repro: "Tekrarlanabilirlik",
    questions: "Sorulacak sorular",
    soWhat: "Ne anlama geliyor",
    readNext: "Sırada ne okumalı",
    glossary: "Terim sözlüğü (TR / EN)",
    general: "genel bilgi",
    why: "Neden",
    exported: "Dışa aktarıldı",
    models: "Modeller",
    draftNote: "Bu bir taslak — bazı bölümler eksik kalmış olabilir.",
    category: "Kategori",
    context: "Bağlam",
    correctness: "Doğruluk",
    contributionsC: "Katkı",
    clarity: "Açıklık",
    soundness: "Sağlamlık",
    novelty: "Yenilik",
    significance: "Önem",
    term: "Terim",
  },
  en: {
    tldr: "Summary",
    glance: "At a glance",
    fiveCs: "5 C's assessment",
    problem: "Problem & motivation",
    prior: "Prior work & the gap",
    contributions: "Contributions",
    keyIdea: "Key idea (in plain terms)",
    method: "Method walkthrough",
    howSolves: "How it solves the problem",
    results: "Key results & evidence",
    critique: "Critical evaluation (reviewer lens)",
    weakest: "Weakest link",
    limitations: "Assumptions, limitations & threats to validity",
    repro: "Reproducibility",
    questions: "Questions to ask",
    soWhat: "So what — significance",
    readNext: "What to read next",
    glossary: "Glossary (TR / EN)",
    general: "general knowledge",
    why: "Why",
    exported: "Exported",
    models: "Models",
    draftNote: "This is a draft — some sections may be incomplete.",
    category: "Category",
    context: "Context",
    correctness: "Correctness",
    contributionsC: "Contributions",
    clarity: "Clarity",
    soundness: "Soundness",
    novelty: "Novelty",
    significance: "Significance",
    term: "Term",
  },
} as const;

type Labels = Record<keyof (typeof L)["tr"], string>;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safePdfFilename(title: string): string {
  const slug = title
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || "analiz"}.pdf`;
}

function renderClaims(claims: AnalysisClaim[], t: Labels): string {
  if (!claims || claims.length === 0) return "";
  const items = claims
    .map((c) => {
      const text = escapeHtml(c.text);
      if (c.grounding === "general") {
        return `<li>${text}<span class="gen">${t.general}</span></li>`;
      }
      const cites = (c.citations ?? [])
        .map((cit) => {
          const page = typeof cit.page === "number" ? ` (s.${cit.page})` : "";
          return `<div class="quote">“${escapeHtml(cit.quote)}”${page}</div>`;
        })
        .join("");
      return `<li>${text}${cites}</li>`;
    })
    .join("");
  return `<ul>${items}</ul>`;
}

function section(title: string, inner: string): string {
  if (!inner.trim()) return "";
  return `<section><h2>${escapeHtml(title)}</h2>${inner}</section>`;
}

function buildBody(record: ArticleAnalysisRecord, exportedAt: number): string {
  const t = L[record.targetLang] ?? L.en;
  const p = record.payload;
  if (!p) return "";

  const exportedStr = new Date(exportedAt).toLocaleString(
    record.targetLang === "tr" ? "tr-TR" : "en-US",
  );
  const meta =
    `<div class="meta">` +
    `<span><b>${t.exported}:</b> ${escapeHtml(exportedStr)}</span>` +
    `<span><b>${t.models}:</b> ${escapeHtml(record.modelSnapshot.extract)} · ${escapeHtml(record.modelSnapshot.synthesize)} · ${escapeHtml(record.modelSnapshot.critique)}</span>` +
    `</div>`;

  const draft =
    record.status === "draft"
      ? `<div class="draft">${escapeHtml(t.draftNote)}${record.fallbackReason ? ` (${escapeHtml(record.fallbackReason)})` : ""}</div>`
      : "";

  const glance = `<dl class="glance">${[
    [t.category, p.ataGlance.paperType],
    ["Alan / Field", [p.ataGlance.field, p.ataGlance.subfield].filter(Boolean).join(" · ")],
    ["Yazar / Authors", p.ataGlance.authors],
    ["Venue / Year", p.ataGlance.venueYear],
    ["Amaç / Purpose", p.ataGlance.purpose],
    ["Yöntem / Method", p.ataGlance.methodologyType],
    ["Veri / Data", p.ataGlance.dataSample],
    ["Bulgu / Finding", p.ataGlance.headlineFinding],
    ["Olgunluk / Maturity", p.ataGlance.maturity],
  ]
    .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
    .map(([k, v]) => `<dt>${escapeHtml(String(k))}</dt><dd>${escapeHtml(String(v))}</dd>`)
    .join("")}</dl>`;

  const fiveCs = `<dl class="glance">${[
    [t.category, p.fiveCs.category],
    [t.context, p.fiveCs.context],
    [t.correctness, p.fiveCs.correctness],
    [t.contributionsC, p.fiveCs.contributions],
    [t.clarity, p.fiveCs.clarity],
  ]
    .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
    .map(([k, v]) => `<dt>${escapeHtml(String(k))}</dt><dd>${escapeHtml(String(v))}</dd>`)
    .join("")}</dl>`;

  const methodSteps = p.methodWalkthrough.length
    ? `<ol>${p.methodWalkthrough
        .map(
          (s) =>
            `<li>${escapeHtml(s.step)}${s.why ? ` <span class="why">— ${escapeHtml(t.why)}: ${escapeHtml(s.why)}</span>` : ""}</li>`,
        )
        .join("")}</ol>`
    : "";

  const critique = `<dl class="glance">${[
    [t.soundness, p.critique.soundness],
    [t.novelty, p.critique.novelty],
    [t.significance, p.critique.significance],
    [t.clarity, p.critique.clarity],
  ]
    .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
    .map(([k, v]) => `<dt>${escapeHtml(String(k))}</dt><dd>${escapeHtml(String(v))}</dd>`)
    .join("")}</dl>${
    p.critique.weakestLink
      ? `<p><span class="weakest">${escapeHtml(t.weakest)}:</span> ${escapeHtml(p.critique.weakestLink)}</p>`
      : ""
  }`;

  const questions = p.questionsToAsk.length
    ? `<ul>${p.questionsToAsk.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul>`
    : "";

  const readNext = p.whatToReadNext.length
    ? `<ul>${p.whatToReadNext
        .map(
          (r) =>
            `<li><span class="term">${escapeHtml(r.title)}</span>${r.why ? ` — ${escapeHtml(r.why)}` : ""}<span class="gen">${t.general}</span></li>`,
        )
        .join("")}</ul>`
    : "";

  const glossary = p.glossary.length
    ? `<table class="gloss"><thead><tr><th>${escapeHtml(t.term)}</th><th>TR</th><th>EN</th></tr></thead><tbody>${p.glossary
        .map(
          (g) =>
            `<tr><td class="term">${escapeHtml(g.term)}${g.symbol ? ` <span class="quote">${escapeHtml(g.symbol)}</span>` : ""}</td><td>${escapeHtml(g.tr)}</td><td>${escapeHtml(g.en)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : "";

  return [
    `<h1>${escapeHtml(record.title)}</h1>`,
    meta,
    draft,
    p.tldr ? `<p class="lede">${escapeHtml(p.tldr)}</p>` : "",
    section(t.glance, glance),
    section(t.fiveCs, fiveCs),
    section(t.problem, renderClaims(p.problemMotivation, t)),
    section(t.prior, renderClaims(p.priorWorkGap, t)),
    section(t.contributions, renderClaims(p.contributions, t)),
    section(t.keyIdea, p.keyIdea ? `<p>${escapeHtml(p.keyIdea)}<span class="gen">${t.general}</span></p>` : ""),
    section(t.method, methodSteps),
    section(t.howSolves, renderClaims(p.howItSolves, t)),
    section(t.results, renderClaims(p.keyResults, t)),
    section(t.critique, critique),
    section(t.limitations, renderClaims(p.assumptionsLimitations, t)),
    section(t.repro, p.reproducibility ? `<p>${escapeHtml(p.reproducibility)}</p>` : ""),
    section(t.questions, questions),
    section(t.soWhat, p.soWhat ? `<p>${escapeHtml(p.soWhat)}<span class="gen">${t.general}</span></p>` : ""),
    section(t.readNext, readNext),
    section(t.glossary, glossary),
  ].join("");
}

function buildStyleBlock(theme: PdfTheme): string {
  const vars = THEME_VARS[theme] ?? THEME_VARS.white;
  const cssVars = Object.entries(vars)
    .map(([k, v]) => `--${k}: ${v};`)
    .join(" ");
  return `<style>:root, .tme-an { ${cssVars} } ${STYLE_RULES}</style>`;
}

export function analysisToHtml(
  record: ArticleAnalysisRecord,
  options: { theme?: PdfTheme; exportedAt?: number } = {},
): string {
  const theme = options.theme ?? "white";
  const exportedAt = options.exportedAt ?? 0;
  const body = buildBody(record, exportedAt);
  return (
    `<!DOCTYPE html><html lang="${record.targetLang}"><head><meta charset="utf-8"><title>${escapeHtml(record.title)}</title>` +
    buildStyleBlock(theme) +
    `</head><body class="tme-an">${body}</body></html>`
  );
}

// Render via the browser's native print-to-PDF rather than html2canvas
// rasterization: the themed HTML is written into a hidden same-origin iframe
// and `print()`ed, so the user gets a vector PDF with selectable text and
// correct fonts through the standard "Save as PDF" destination. This is far
// more reliable across browsers + the Tauri webview than a programmatic blob
// download (which several environments block silently).
async function renderHtmlToPdf(html: string, filename: string): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("PDF export is only available in the browser");
  }
  // The print dialog seeds its default filename from the document <title>.
  const title = filename.replace(/\.pdf$/i, "").replace(/[<>&"]/g, "");
  const titledHtml = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${title}</title>`,
  );

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
    visibility: "hidden",
  } satisfies Partial<CSSStyleDeclaration>);

  try {
    await new Promise<void>((resolve, reject) => {
      iframe.onload = () => {
        const win = iframe.contentWindow;
        if (!win) {
          reject(new Error("print_frame_unavailable"));
          return;
        }
        // Let layout settle a tick before invoking the (blocking) dialog.
        window.setTimeout(() => {
          try {
            win.focus();
            win.print();
            resolve();
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }, 120);
      };
      iframe.srcdoc = titledHtml;
      document.body.appendChild(iframe);
    });
  } finally {
    // Keep the frame alive briefly so a non-blocking print() (Firefox) can
    // still read it, then clean up.
    window.setTimeout(() => iframe.remove(), 1500);
  }
}

/**
 * Render a ready/draft analysis to an A4 PDF and trigger a browser download.
 * Throws if the analysis has no payload yet (still generating / errored).
 */
export async function exportAnalysisAsPdf(
  record: ArticleAnalysisRecord,
  options: { theme?: PdfTheme; exportedAt?: number } = {},
): Promise<void> {
  if (!record.payload) {
    throw new Error("analysis_not_ready");
  }
  const html = analysisToHtml(record, options);
  await renderHtmlToPdf(html, safePdfFilename(record.title));
}
