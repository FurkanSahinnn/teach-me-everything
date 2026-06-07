import { describe, expect, it } from "vitest";
import {
  defaultContentLangMode,
  deriveGenLocale,
  resolveBilingualPair,
} from "./content-language";

describe("deriveGenLocale", () => {
  it("tr / en are single-language, no translate pass", () => {
    expect(deriveGenLocale("tr", "tr")).toEqual({
      primary: "tr",
      keepEnglishTerms: false,
      translateTo: null,
    });
    expect(deriveGenLocale("en", "tr")).toEqual({
      primary: "en",
      keepEnglishTerms: false,
      translateTo: null,
    });
  });

  it("en_terms_tr keeps a Turkish primary + flips keepEnglishTerms on", () => {
    expect(deriveGenLocale("en_terms_tr", "en")).toEqual({
      primary: "tr",
      keepEnglishTerms: true,
      translateTo: null,
    });
  });

  it("both generates in the base locale and translates into the other", () => {
    expect(deriveGenLocale("both", "tr")).toEqual({
      primary: "tr",
      keepEnglishTerms: false,
      translateTo: "en",
    });
    expect(deriveGenLocale("both", "en")).toEqual({
      primary: "en",
      keepEnglishTerms: false,
      translateTo: "tr",
    });
  });
});

describe("resolveBilingualPair", () => {
  it("returns only the base when there is no translation target", () => {
    expect(resolveBilingualPair("tr", null, "Merhaba", undefined)).toEqual({
      base: "Merhaba",
      en: undefined,
    });
  });

  it("tr primary: base stays Turkish, en holds the translation", () => {
    expect(resolveBilingualPair("tr", "en", "Merhaba", "Hello")).toEqual({
      base: "Merhaba",
      en: "Hello",
    });
  });

  it("en primary: base becomes the Turkish translation, en holds the source", () => {
    expect(resolveBilingualPair("en", "tr", "Hello", "Merhaba")).toEqual({
      base: "Merhaba",
      en: "Hello",
    });
  });

  it("falls back to the source when a translation is missing (tr primary)", () => {
    expect(resolveBilingualPair("tr", "en", "Merhaba", undefined)).toEqual({
      base: "Merhaba",
      en: "Merhaba",
    });
  });

  it("falls back to the source when a translation is missing (en primary)", () => {
    // base would have been the TR translation; with none, keep the EN source so
    // nothing renders blank.
    expect(resolveBilingualPair("en", "tr", "Hello", undefined)).toEqual({
      base: "Hello",
      en: "Hello",
    });
  });
});

describe("defaultContentLangMode", () => {
  it("an explicit tr/en AI-response locale wins", () => {
    expect(defaultContentLangMode("en", "tr")).toBe("en");
    expect(defaultContentLangMode("tr", "en")).toBe("tr");
  });

  it("follow_source / undefined fall through to the UI locale", () => {
    expect(defaultContentLangMode("follow_source", "tr")).toBe("tr");
    expect(defaultContentLangMode("follow_source", "en")).toBe("en");
    expect(defaultContentLangMode(undefined, "en")).toBe("en");
    expect(defaultContentLangMode(undefined, "tr")).toBe("tr");
  });
});
