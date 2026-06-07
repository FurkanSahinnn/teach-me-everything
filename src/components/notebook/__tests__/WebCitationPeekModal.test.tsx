import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WebCitationPeekModal } from "../WebCitationPeekModal";
import type { WebCitation } from "@/lib/ai/web-search/types";

const citation: WebCitation = {
  result: {
    url: "https://arxiv.org/abs/2401.12345",
    title: "Topological qubits at room temperature",
    snippet: "We demonstrate a stable Majorana mode …",
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

describe("WebCitationPeekModal", () => {
  it("renders title + snippet when open", () => {
    render(
      <WebCitationPeekModal
        open
        citation={citation}
        onClose={() => {}}
        onMakeSource={() => Promise.resolve("src_1")}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText("Topological qubits at room temperature"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Majorana mode/),
    ).toBeInTheDocument();
    // Domain shown in the description bar.
    expect(screen.getByText("arxiv.org")).toBeInTheDocument();
  });

  it("invokes onMakeSource and flips to a 'done' state on success", async () => {
    const onMakeSource = vi.fn().mockResolvedValue("src_abc");
    const user = userEvent.setup();
    render(
      <WebCitationPeekModal
        open
        citation={citation}
        onClose={() => {}}
        onMakeSource={onMakeSource}
      />,
    );

    const cta = screen.getByTestId("web-citation-make-source");
    await user.click(cta);

    expect(onMakeSource).toHaveBeenCalledTimes(1);
    expect(onMakeSource).toHaveBeenCalledWith(citation);

    // Done banner appears.
    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
    // Button stays disabled after success — no double-ingest.
    expect(cta).toBeDisabled();
  });

  it("surfaces error message in an alert when onMakeSource rejects", async () => {
    const onMakeSource = vi
      .fn()
      .mockRejectedValue(new Error("fetch failed (504)"));
    const user = userEvent.setup();
    render(
      <WebCitationPeekModal
        open
        citation={citation}
        onClose={() => {}}
        onMakeSource={onMakeSource}
      />,
    );

    await user.click(screen.getByTestId("web-citation-make-source"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /fetch failed \(504\)/,
      );
    });
  });

  it("hides the Make a source button when enableMakeSource={false}", () => {
    render(
      <WebCitationPeekModal
        open
        citation={citation}
        onClose={() => {}}
        onMakeSource={() => Promise.resolve("src_1")}
        enableMakeSource={false}
      />,
    );
    expect(
      screen.queryByTestId("web-citation-make-source"),
    ).not.toBeInTheDocument();
    // External-open button stays.
    expect(
      screen.getByRole("button", { name: /tarayıcıda aç|open in browser/i }),
    ).toBeInTheDocument();
  });

  it("opens the URL in a new tab when 'Open in browser' is clicked", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();
    render(
      <WebCitationPeekModal
        open
        citation={citation}
        onClose={() => {}}
        onMakeSource={() => Promise.resolve("src_1")}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /tarayıcıda aç|open in browser/i }),
    );

    expect(openSpy).toHaveBeenCalledWith(
      "https://arxiv.org/abs/2401.12345",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });
});
