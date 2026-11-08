import { afterEach, describe, expect, it } from "vitest";

import type { QuizAnswer, QuizItem } from "@/lib/quiz/types";
import {
  createQuizSession,
  finishQuizSession,
  getLatestQuizResult,
} from "./quiz-sessions";
import { db } from "./schema";

function mcq(q: string): QuizItem {
  return { kind: "mcq", q, choices: ["a", "b", "c", "d"], correctIndex: 0 };
}

function answer(itemIndex: number, correct: boolean): QuizAnswer {
  return { kind: "mcq", itemIndex, selectedIndex: correct ? 0 : 1, correct, answeredAt: 1 };
}

async function finishedSession(
  workspaceId: string,
  finishedAt: number,
  results: boolean[],
) {
  const session = await createQuizSession({
    workspaceId,
    items: results.map((_, i) => mcq(`q${i}`)),
  });
  const answers = results.map((ok, i) => answer(i, ok));
  const correct = results.filter(Boolean).length;
  await finishQuizSession(session.id, {
    finishedAt,
    score: correct / results.length,
    answers,
  });
  return session;
}

describe("getLatestQuizResult", () => {
  afterEach(async () => {
    await db.quizSessions.clear();
  });

  it("returns null when the workspace has no finished quiz", async () => {
    await createQuizSession({ workspaceId: "ws-1", items: [mcq("open one")] });

    expect(await getLatestQuizResult("ws-1")).toBeNull();
  });

  it("reports correct and total answers of the most recently finished quiz", async () => {
    await finishedSession("ws-1", 1_000, [true, false]);
    await finishedSession("ws-1", 2_000, [true, true, false, true]);
    await finishedSession("ws-2", 3_000, [false]);

    expect(await getLatestQuizResult("ws-1")).toEqual({ correct: 3, total: 4 });
  });
});
