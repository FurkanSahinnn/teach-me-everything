// Shared "language of AI-generated content" plumbing, used by the
// flashcard / quiz / mind-map generators (and mirrored by the roadmap wizard).
//
// Four user-facing modes, captured per generation:
//   tr           → all content Turkish
//   en           → all content English
//   en_terms_tr  → Turkish explanations, technical terms kept in English
//   both         → generate in one language + translate into the other so the
//                  view can flip TR⇄EN instantly (stored in parallel `*En`
//                  fields, the app's existing dual-field convention).
export type ContentLangMode = "tr" | "en" | "en_terms_tr" | "both";

// Default mode from the user's existing locale settings: an explicit tr/en
// AI-response locale wins, otherwise the UI locale. `follow_source`/undefined
// fall through to the UI locale as a concrete single language.
export function defaultContentLangMode(
  aiResponseLocale: "tr" | "en" | "follow_source" | undefined,
  locale: "tr" | "en",
): ContentLangMode {
  if (aiResponseLocale === "en") return "en";
  if (aiResponseLocale === "tr") return "tr";
  return locale === "en" ? "en" : "tr";
}

// Map a mode to generation parameters: which single language the canonical
// generation runs in, whether to keep English terms, and (for "both") which
// language to translate the result into afterwards.
export function deriveGenLocale(
  mode: ContentLangMode,
  baseLocale: "tr" | "en",
): {
  primary: "tr" | "en";
  keepEnglishTerms: boolean;
  translateTo: "tr" | "en" | null;
} {
  switch (mode) {
    case "tr":
      return { primary: "tr", keepEnglishTerms: false, translateTo: null };
    case "en":
      return { primary: "en", keepEnglishTerms: false, translateTo: null };
    case "en_terms_tr":
      return { primary: "tr", keepEnglishTerms: true, translateTo: null };
    case "both":
      return {
        primary: baseLocale,
        keepEnglishTerms: false,
        translateTo: baseLocale === "tr" ? "en" : "tr",
      };
  }
}

// The one extra prompt rule appended when keepEnglishTerms is on (only
// meaningful with a Turkish primary). Generators splice this into their rule
// list so the behaviour is identical everywhere.
export const KEEP_EN_TERMS_RULE_TR =
  "- Teknik terimleri İngilizce orijinal haliyle bırak (örn. \"attention\", \"gradient descent\"); açıklamaları Türkçe yaz.";

// Given a primary language + a translation map, resolve a (base = Turkish,
// English) pair for one record's field. The base field always holds Turkish
// and `*En` always English. A missing translation falls back to the source.
export function resolveBilingualPair(
  primary: "tr" | "en",
  translateTo: "tr" | "en" | null,
  srcValue: string,
  translatedValue: string | undefined,
): { base: string; en: string | undefined } {
  if (!translateTo) return { base: srcValue, en: undefined };
  if (primary === "tr") {
    return { base: srcValue, en: translatedValue ?? srcValue };
  }
  // primary === "en": source is English, the translation is the Turkish base.
  return { base: translatedValue ?? srcValue, en: srcValue };
}
