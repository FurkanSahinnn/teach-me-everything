import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  WebCitationChip,
  citationDomainLabel,
  googleFaviconUrl,
} from "../WebCitationChip";
import type { WebCitation } from "@/lib/ai/web-search/types";

const citation: WebCitation = {
  result: {
    url: "https://www.example.com/article?id=42",
    title: "Latest on quantum computing",
    snippet: "A breakthrough was announced this week …",
    provider: "anthropic",
    publishedAt: "2026-05-11",
  },
  messageBlockIndex: 0,
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("citationDomainLabel", () => {
  it("strips www. and trailing path", () => {
    expect(citationDomainLabel("https://www.example.com/x/y")).toBe(
      "example.com",
    );
  });

  it("leaves bare hosts untouched", () => {
    expect(citationDomainLabel("https://arxiv.org/abs/2401.12345")).toBe(
      "arxiv.org",
    );
  });

  it("falls back to the raw string on malformed input", () => {
    expect(citationDomainLabel("not a url")).toBe("not a url");
  });
});

describe("googleFaviconUrl", () => {
  it("produces a Google s2 favicon proxy for a valid http URL", () => {
    const out = googleFaviconUrl("https://example.com/path");
    expect(out).toBe(
      "https://www.google.com/s2/favicons?sz=32&domain=example.com",
    );
  });

  it("returns null for non-http schemes", () => {
    expect(googleFaviconUrl("ftp://example.com")).toBeNull();
    expect(googleFaviconUrl("javascript:alert(1)")).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(googleFaviconUrl("not a url")).toBeNull();
  });
});

describe("WebCitationChip", () => {
  it("renders the domain label and forwards click events", async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(<WebCitationChip citation={citation} onActivate={onActivate} />);

    const chip = screen.getByTestId("web-citation-chip");
    expect(chip).toHaveTextContent("example.com");
    expect(chip).toHaveAttribute(
      "data-citation-url",
      "https://www.example.com/article?id=42",
    );

    await user.click(chip);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(citation);
  });

  it("renders the numeric index when provided", () => {
    render(
      <WebCitationChip
        citation={citation}
        onActivate={() => {}}
        index={3}
      />,
    );
    expect(screen.getByTestId("web-citation-chip")).toHaveTextContent("3");
  });

  it("omits the numeric index when not provided", () => {
    render(<WebCitationChip citation={citation} onActivate={() => {}} />);
    // Domain still rendered, but no 1/2/3 marker.
    const chip = screen.getByTestId("web-citation-chip");
    expect(chip).toHaveTextContent("example.com");
    expect(chip).not.toHaveTextContent(/^\d+/);
  });
});
