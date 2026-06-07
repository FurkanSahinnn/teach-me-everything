// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { WebSearchSection } from "@/components/settings/WebSearchSection";
import { usePrefs, DEFAULT_WEB_SEARCH_PREFS } from "@/stores/prefs";
import tr from "../../../../messages/tr.json";

function renderSection() {
  return render(
    <NextIntlClientProvider locale="tr" messages={tr as never}>
      <WebSearchSection />
    </NextIntlClientProvider>,
  );
}

describe("WebSearchSection", () => {
  beforeEach(() => {
    usePrefs.setState({ webSearchPrefs: { ...DEFAULT_WEB_SEARCH_PREFS } });
  });
  afterEach(() => {
    cleanup();
  });

  it("renders default values from the store", () => {
    renderSection();
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.value).toBe("5");
  });

  it("writes max_uses changes through the clamping setter", () => {
    renderSection();
    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "8" } });
    expect(usePrefs.getState().webSearchPrefs.maxUses).toBe(8);
  });

  it("parses allowed domains from CSV textarea", () => {
    renderSection();
    const textarea = screen.getByPlaceholderText(
      /arxiv\.org, doi\.org/,
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: "arxiv.org, doi.org, ,  wikipedia.org" },
    });
    expect(usePrefs.getState().webSearchPrefs.allowedDomains).toEqual([
      "arxiv.org",
      "doi.org",
      "wikipedia.org",
    ]);
  });

  it("recency segmented chip writes the matching days bucket", () => {
    renderSection();
    // Tr label for the day chip: "Son 24 saat"
    const dayChip = screen.getByRole("radio", { name: "Son 24 saat" });
    fireEvent.click(dayChip);
    expect(usePrefs.getState().webSearchPrefs.recencyDays).toBe(1);
  });

  it("renders the enable toggle synced with store state", () => {
    usePrefs.setState({
      webSearchPrefs: { ...DEFAULT_WEB_SEARCH_PREFS, enabled: true },
    });
    renderSection();
    const sw = screen.getByRole("switch", {
      name: /Sohbet açıldığında web aramayı aç/i,
    });
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });
});
