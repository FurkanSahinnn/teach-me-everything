// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";

import { ChatModelPicker } from "@/components/settings/models/ChatModelPicker";
import { listChatOptions } from "@/lib/ai/model-options";
import { usePrefs } from "@/stores/prefs";
import en from "../../../../messages/en.json";

beforeAll(() => {
  // cmdk scrolls the active item into view and observes list size.
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});

const OPTIONS = listChatOptions().filter((o) => o.presetId === "anthropic" || o.presetId === "openai");

function renderPicker(props: Partial<Parameters<typeof ChatModelPicker>[0]> = {}) {
  usePrefs.setState({ locale: "en" });
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={en as never}>
      <ChatModelPicker
        label="Chat"
        value="anthropic::claude-sonnet-4-6"
        options={OPTIONS}
        onChange={onChange}
        isProviderReady={() => true}
        onAddKey={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onChange };
}

describe("ChatModelPicker", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the current model and provider on the trigger", () => {
    renderPicker();

    const trigger = screen.getByRole("button", { name: /choose model for chat/i });
    expect(trigger).toHaveTextContent("Claude Sonnet 4.6");
    expect(trigger).toHaveTextContent("Anthropic");
  });

  it("marks the trigger when the provider has no key", () => {
    renderPicker({ isProviderReady: () => false });

    expect(screen.getByRole("button", { name: /choose model for chat/i })).toHaveTextContent("No key");
  });

  it("selects a model from another provider and closes", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();

    await user.click(screen.getByRole("button", { name: /choose model for chat/i }));
    const panel = await screen.findByRole("dialog", { name: /model for chat/i });
    await user.click(within(panel).getByRole("button", { name: /openai/i }));
    const firstModel = (await within(panel).findAllByRole("option"))[0];
    if (!firstModel) throw new Error("no model options rendered");
    await user.click(firstModel);

    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^openai::/));
    expect(screen.queryByRole("dialog", { name: /model for chat/i })).toBeNull();
  });

  it("accepts a custom model id for the browsed provider", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();

    await user.click(screen.getByRole("button", { name: /choose model for chat/i }));
    const panel = await screen.findByRole("dialog", { name: /model for chat/i });
    await user.type(within(panel).getByRole("textbox", { name: /custom model id/i }), "claude-experimental-1");
    await user.click(within(panel).getByRole("button", { name: /^use$/i }));

    expect(onChange).toHaveBeenCalledWith("anthropic::claude-experimental-1");
  });
});
