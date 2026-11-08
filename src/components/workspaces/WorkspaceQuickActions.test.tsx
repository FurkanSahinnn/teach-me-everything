// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import {
  WorkspaceQuickActions,
  type WorkspaceQuickStats,
} from "@/components/workspaces/WorkspaceQuickActions";
import en from "../../../messages/en.json";

const EMPTY: WorkspaceQuickStats = {
  flashcardCount: 0,
  dueFlashcardCount: 0,
  lastQuiz: null,
  conceptCount: 0,
  conceptEdgeCount: 0,
};

function renderActions(stats: WorkspaceQuickStats) {
  return render(
    <NextIntlClientProvider locale="en" messages={en as never}>
      <WorkspaceQuickActions workspaceId="ws-1" firstSourceHref="/w/ws-1" stats={stats} />
    </NextIntlClientProvider>,
  );
}

function cardText(name: RegExp): string {
  return screen.getByRole("link", { name }).textContent ?? "";
}

describe("WorkspaceQuickActions", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows empty states instead of sample numbers for a new workspace", () => {
    renderActions(EMPTY);

    expect(cardText(/card review/i)).toContain("No cards yet");
    expect(cardText(/start quiz/i)).toContain("No quiz yet");
    expect(cardText(/mind map/i)).toContain("No concepts yet");
    expect(screen.queryByText(/7 cards today|8 questions|42 concepts/)).toBeNull();
  });

  it("shows the real due-card count, last quiz result and graph size", () => {
    renderActions({
      flashcardCount: 20,
      dueFlashcardCount: 3,
      lastQuiz: { correct: 6, total: 8 },
      conceptCount: 12,
      conceptEdgeCount: 1,
    });

    expect(cardText(/card review/i)).toContain("3 cards due today");
    expect(cardText(/start quiz/i)).toContain("Last: 6/8 correct");
    expect(cardText(/mind map/i)).toContain("12 concepts · 1 link");
  });

  it("says nothing is due when cards exist but none are due", () => {
    renderActions({ ...EMPTY, flashcardCount: 5 });

    expect(cardText(/card review/i)).toContain("Nothing due today");
  });

  it("links each card to its workspace page", () => {
    renderActions(EMPTY);

    expect(screen.getByRole("link", { name: /card review/i })).toHaveAttribute("href", "/w/ws-1/cards");
    expect(screen.getByRole("link", { name: /start quiz/i })).toHaveAttribute("href", "/w/ws-1/quiz");
    expect(screen.getByRole("link", { name: /mind map/i })).toHaveAttribute("href", "/w/ws-1/map");
  });
});
