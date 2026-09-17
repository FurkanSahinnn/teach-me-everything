import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { EmbedSection } from "./EmbedSection";

const mocks = vi.hoisted(() => ({
  workspaces: [] as { id: string; name: string }[],
  plan: vi.fn(),
}));
vi.mock("@/lib/db/hooks", () => ({ useWorkspaces: () => mocks.workspaces }));
vi.mock("@/lib/ingest/reembed", () => ({ planReembed: mocks.plan, deriveEmbedStatus: () => "not-embedded" }));
vi.mock("@/lib/storage/quota", () => ({ pruneEmbeddings: vi.fn() }));
vi.mock("./ReembedModal", () => ({ ReembedModal: () => null }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/i18n/IntlProvider", () => ({ useLocalePick: () => (_tr: string, en: string) => en }));

beforeEach(() => {
  mocks.workspaces = [{ id: "a", name: "A" }];
  mocks.plan.mockReset().mockResolvedValue({ totalChunks: 1, embeddedCount: 0, toReembed: 1 });
});
afterEach(cleanup);

it("does not repeat probes for equivalent workspace data but probes changed IDs", async () => {
  const { rerender } = render(<EmbedSection />);
  await waitFor(() => expect(mocks.plan).toHaveBeenCalledTimes(1));
  mocks.workspaces = [{ id: "a", name: "Renamed" }];
  rerender(<EmbedSection />);
  expect(mocks.plan).toHaveBeenCalledTimes(1);
  mocks.workspaces = [{ id: "b", name: "B" }];
  rerender(<EmbedSection />);
  await waitFor(() => expect(mocks.plan).toHaveBeenCalledTimes(2));
  expect(mocks.plan).toHaveBeenLastCalledWith({ kind: "workspace", workspaceId: "b" }, "openai-3-small");
});

it("treats IDs containing commas as distinct from multiple workspace IDs", async () => {
  mocks.workspaces = [{ id: "a,b", name: "Combined" }];
  const { rerender } = render(<EmbedSection />);
  await waitFor(() => expect(mocks.plan).toHaveBeenCalledTimes(1));
  mocks.workspaces = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
  rerender(<EmbedSection />);
  await waitFor(() => expect(mocks.plan).toHaveBeenCalledTimes(3));
});
