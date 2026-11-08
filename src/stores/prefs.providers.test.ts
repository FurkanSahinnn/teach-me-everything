import { beforeEach, describe, expect, it } from "vitest";

import { usePrefs } from "./prefs";

describe("setProviderEnabled", () => {
  beforeEach(() => {
    usePrefs.setState({ disabledProviders: [] });
  });

  it("starts with every provider enabled", () => {
    expect(usePrefs.getState().disabledProviders).toEqual([]);
  });

  it("disables a provider once, even when called twice", () => {
    usePrefs.getState().setProviderEnabled("openai", false);
    usePrefs.getState().setProviderEnabled("openai", false);

    expect(usePrefs.getState().disabledProviders).toEqual(["openai"]);
  });

  it("re-enables a disabled provider without touching others", () => {
    usePrefs.setState({ disabledProviders: ["openai", "groq"] });

    usePrefs.getState().setProviderEnabled("openai", true);

    expect(usePrefs.getState().disabledProviders).toEqual(["groq"]);
  });
});
