import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SourceScopePicker } from "./SourceScopePicker";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/IntlProvider", () => ({ useLocalePick: () => (_tr: string, en: string) => en }));
afterEach(cleanup);

it("closes a source menu when generation starts and keeps it closed afterward", () => {
  const props = { sources: [{ id: "source", title: "Paper", type: "pdf" }], selectedSourceIds: [], onChange: vi.fn() };
  const { rerender } = render(<SourceScopePicker {...props} />);
  fireEvent.click(screen.getByTestId("workspace-source-scope-trigger"));
  expect(screen.getByRole("listbox")).toBeInTheDocument();
  rerender(<SourceScopePicker {...props} disabled />);
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  rerender(<SourceScopePicker {...props} />);
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(props.onChange).not.toHaveBeenCalled();
});
