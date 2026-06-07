import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PresetChooser, DynamicKeyField } from "../PresetChooser";
import {
  getQuickStartPreset,
  QUICK_START_PRESETS,
} from "@/lib/ai/quick-start-presets";

// vitest.config.ts has globals: false, so RTL's automatic afterEach cleanup
// hook never registers. Without explicit cleanup, multiple <PresetChooser>
// renders accumulate in document.body and getAllByRole("radio") returns
// tiles from every prior test, which breaks tabindex / aria-checked
// assertions that assume a single render.
beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe("PresetChooser", () => {
  it("renders one tile per preset and exposes radiogroup semantics", () => {
    render(<PresetChooser selectedId={null} onSelect={() => {}} />);

    const group = screen.getByRole("radiogroup");
    expect(group).toBeInTheDocument();

    const tiles = screen.getAllByRole("radio");
    expect(tiles).toHaveLength(QUICK_START_PRESETS.length);
  });

  it("first tile is in the tab order when nothing is selected (roving tabindex)", () => {
    render(<PresetChooser selectedId={null} onSelect={() => {}} />);
    const tiles = screen.getAllByRole("radio");
    expect(tiles[0]).toHaveAttribute("tabindex", "0");
    for (let i = 1; i < tiles.length; i += 1) {
      expect(tiles[i]).toHaveAttribute("tabindex", "-1");
    }
  });

  it("only the selected tile is in tab order once a selection exists", () => {
    render(<PresetChooser selectedId="ollama" onSelect={() => {}} />);
    const tiles = screen.getAllByRole("radio");
    const ollama = tiles.find(
      (t) => t.getAttribute("aria-checked") === "true",
    );
    expect(ollama).toBeDefined();
    expect(ollama).toHaveAttribute("tabindex", "0");
    for (const t of tiles) {
      if (t === ollama) continue;
      expect(t).toHaveAttribute("tabindex", "-1");
    }
  });

  it("clicking a tile fires onSelect with the matching preset id", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<PresetChooser selectedId={null} onSelect={onSelect} />);

    const groqTile = screen
      .getAllByRole("radio")
      .find((t) => t.textContent?.includes("Groq"));
    expect(groqTile).toBeDefined();
    await user.click(groqTile!);

    expect(onSelect).toHaveBeenCalledWith("groq");
  });

  it("ArrowRight on a focused tile fires onSelect with the next preset", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    // Pre-select index 0 so arrow nav has a known starting point.
    render(
      <PresetChooser
        selectedId={QUICK_START_PRESETS[0]!.id}
        onSelect={onSelect}
      />,
    );

    const tiles = screen.getAllByRole("radio");
    tiles[0]!.focus();
    await user.keyboard("{ArrowRight}");

    expect(onSelect).toHaveBeenCalledWith(QUICK_START_PRESETS[1]!.id);
  });

  it("ArrowLeft from index 0 wraps to the last preset", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <PresetChooser
        selectedId={QUICK_START_PRESETS[0]!.id}
        onSelect={onSelect}
      />,
    );

    const tiles = screen.getAllByRole("radio");
    tiles[0]!.focus();
    await user.keyboard("{ArrowLeft}");

    const last = QUICK_START_PRESETS[QUICK_START_PRESETS.length - 1]!;
    expect(onSelect).toHaveBeenCalledWith(last.id);
  });

  it("End jumps focus + selection to the last preset", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<PresetChooser selectedId={null} onSelect={onSelect} />);
    const tiles = screen.getAllByRole("radio");
    tiles[0]!.focus();
    await user.keyboard("{End}");

    const last = QUICK_START_PRESETS[QUICK_START_PRESETS.length - 1]!;
    expect(onSelect).toHaveBeenCalledWith(last.id);
  });
});

describe("DynamicKeyField", () => {
  it("renders empty hint when no preset selected", () => {
    render(
      <DynamicKeyField preset={null} value="" onChange={() => {}} />,
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Devam etmek için|Pick a provider/i),
    ).toBeInTheDocument();
  });

  it("hides the input and shows install copy when preset is local (Ollama)", () => {
    const ollama = getQuickStartPreset("ollama")!;
    render(
      <DynamicKeyField preset={ollama} value="" onChange={() => {}} />,
    );
    // Password input still has role-of "textbox" — query by absence of any
    // input element instead.
    expect(document.querySelector("input")).toBeNull();
    expect(
      screen.getByText(/Anahtar gerekmiyor|No API key needed/i),
    ).toBeInTheDocument();
  });

  it("renders password input for cloud preset and forwards onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const groq = getQuickStartPreset("groq")!;
    render(
      <DynamicKeyField preset={groq} value="" onChange={onChange} />,
    );

    const input = document.querySelector("input")!;
    expect(input).toBeTruthy();
    expect(input.getAttribute("type")).toBe("password");

    // Controlled input with value="" never updates, so each keystroke fires
    // onChange with the single typed character (not the accumulated string).
    // We assert per-call shape — the parent (Setup Wizard) is responsible for
    // accumulating into vault state.
    await user.type(input, "gsk_test");
    expect(onChange).toHaveBeenCalledTimes(8);
    const calls = onChange.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(["g", "s", "k", "_", "t", "e", "s", "t"]);
  });

  it("provider home url link is present for cloud preset", () => {
    const anthropic = getQuickStartPreset("anthropic")!;
    render(
      <DynamicKeyField
        preset={anthropic}
        value="sk-ant-x"
        onChange={() => {}}
      />,
    );
    const link = screen.getByRole("link", { name: /Anahtar al|Get a key/i });
    expect(link).toHaveAttribute("href", anthropic.providerHomeUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("invalid prop forwards as aria-invalid on the input", () => {
    const gemini = getQuickStartPreset("gemini")!;
    render(
      <DynamicKeyField
        preset={gemini}
        value="bad"
        onChange={() => {}}
        invalid
      />,
    );
    const input = document.querySelector("input")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});
