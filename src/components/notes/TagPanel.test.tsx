import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TagPanel } from "./TagPanel";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/db/hooks", () => ({ useTagsByWorkspace: () => new Map([["science", 2], ["history", 1]]) }));
afterEach(cleanup);

it("exposes the active tag as the selected tree item and follows filter changes", () => {
  const { rerender } = render(<TagPanel workspaceId="w" activeTag="science" />);
  expect(screen.getByRole("treeitem", { selected: true })).toHaveTextContent("science");
  rerender(<TagPanel workspaceId="w" activeTag="history" />);
  expect(screen.getByRole("treeitem", { selected: true })).toHaveTextContent("history");
  rerender(<TagPanel workspaceId="w" />);
  expect(screen.queryByRole("treeitem", { selected: true })).not.toBeInTheDocument();
});
