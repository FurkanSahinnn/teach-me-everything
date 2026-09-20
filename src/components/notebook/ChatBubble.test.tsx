import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChatBubble } from "./ChatBubble";
import type { ChatMessageRecord } from "@/lib/db/types";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/IntlProvider", () => ({ useLocalePick: () => (_tr: string, en: string) => en }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
afterEach(cleanup);

it("can change from an ordinary message to a tool message and back without changing hook order", () => {
  const message: ChatMessageRecord = {
    id: "message", threadId: "thread", workspaceId: "workspace", role: "assistant",
    content: "First answer", createdAt: 1,
  };
  const props = { chunks: [], isStreaming: false, onJumpCitation: vi.fn() };
  const { rerender } = render(<ChatBubble {...props} message={message} />);
  expect(screen.getByText("First answer")).toBeInTheDocument();
  rerender(<ChatBubble {...props} message={{ ...message, role: "tool", content: "Tool result" }} />);
  expect(screen.queryByText("First answer")).not.toBeInTheDocument();
  rerender(<ChatBubble {...props} message={{ ...message, content: "Second answer" }} />);
  expect(screen.getByText("Second answer")).toBeInTheDocument();
});
