import { test, expect, type Page } from "@playwright/test";
import {
  installAiMocks,
  isCurriculumRequest,
  isLessonNoteRequest,
  chunkifyText,
} from "./helpers/mock-ai-routes";
import { seedGuidedStudyWorkspace } from "./helpers/seed-state";

// Topbar buttons sit inside a `position: sticky` shell that, in this dev
// build, gets layered behind a sibling transformed element in some
// renders. Playwright's hit-test thinks the button is "visible and
// clickable" but the synthesized MouseEvent lands on the layer above and
// React's onClick never fires. Dispatching `.click()` on the DOM node
// directly bypasses the hit-test and exercises the same React handler.
async function clickTopbarButton(
  page: Page,
  pattern: RegExp,
): Promise<void> {
  const ok = await page.evaluate((re: { source: string; flags: string }) => {
    const rx = new RegExp(re.source, re.flags);
    const all = Array.from(document.querySelectorAll("button"));
    const btn = all.find(
      (b) => rx.test(b.textContent || "") && !b.disabled,
    ) as HTMLButtonElement | undefined;
    if (!btn) return false;
    btn.click();
    return true;
  }, { source: pattern.source, flags: pattern.flags });
  if (!ok) {
    throw new Error(`clickTopbarButton: no enabled match for ${pattern}`);
  }
}

// End-to-end coverage of the guided-study lane (Phase 4.5):
//
//   /plan  → AI curriculum generate          → curriculum tree visible
//          → "Konuya başla"                  → /study/[lessonId]
//   /study → "Yeniden üret" → AI regenerate  → in-place lesson note update
//          → "Düzenle" → type → autosave     → status flips to "saved"
//          → Q&A "Save Q&A"                  → entry appears in side rail
//          → "Note .pdf" download            → filename + size assertion
//
// The two AI runners (curriculum, lesson-note) speak through the same
// /api/ai/chat endpoint, so the mock branches on system-prompt fingerprint
// — see `isCurriculumRequest` / `isLessonNoteRequest` in mock-ai-routes.
// The JSON envelopes returned must reference the exact source/chunk ids
// seedGuidedStudyWorkspace wrote, otherwise the runners' filterValidRefs
// strips every parsed item and throws "no valid sourceRefs".

test.describe("guided-study happy-path — curriculum → lesson → edit → Q&A → PDF", () => {
  test("generates curriculum, regenerates lesson, autosaves edits, saves Q&A, exports PDF", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // Skipped: the curriculum-generation UI entry point was removed in the
    // Plan→Roadmap migration (Phase 13). `GenerateCurriculumModal` still
    // exists but is no longer mounted/triggered on any page, so the
    // generate→start-topic→study→edit→Q&A→PDF flow is unreachable from the UI.
    // The study-from-a-topic use case is now served by the roadmap
    // NodeInspector ("Generate lesson" / "Make flashcards"). Curriculum /
    // lesson-note logic remains covered by Vitest. Re-enable when curriculum
    // generation has a UI entry again; the body below is kept as the spec.
    test.skip(
      true,
      "Guided-study curriculum generation has no UI entry point post Plan→Roadmap (GenerateCurriculumModal unmounted).",
    );

    const seed = await seedGuidedStudyWorkspace(page);
    const sourceRef = {
      sourceId: seed.sourceId,
      chunkIds: [seed.chunkIds[0]!],
      section: "Wave-Particle Duality",
      quote: "Quantum objects exhibit both wave and particle behavior.",
    };

    const curriculumPayload = JSON.stringify({
      title: "Quantum Mechanics — E2E Curriculum",
      goal: "Build intuition for the foundational pillars of quantum theory.",
      level: "intermediate",
      items: [
        {
          order: 1,
          title: "Wave-Particle Duality",
          objective:
            "Explain how quantum objects switch between wave-like and particle-like behavior.",
          estimateMinutes: 30,
          sourceRefs: [
            {
              sourceId: seed.sourceId,
              chunkIds: [seed.chunkIds[0]!],
              section: "Wave-Particle Duality",
              quote: "Wave-particle duality is the central concept...",
            },
          ],
        },
        {
          order: 2,
          title: "Superposition",
          objective:
            "Reason about quantum systems existing in multiple states until measurement.",
          estimateMinutes: 35,
          sourceRefs: [
            {
              sourceId: seed.sourceId,
              chunkIds: [seed.chunkIds[1]!],
              section: "Superposition",
              quote: "Superposition allows quantum systems...",
            },
          ],
        },
      ],
    });

    const lessonNoteMarkdown = [
      "# Wave-Particle Duality",
      "",
      "This lesson covers the foundational result that quantum objects",
      "behave as both waves and particles depending on context.",
      "",
      "## Key concepts",
      "",
      "- The double-slit experiment shows interference for individual particles.",
      "- Measurement collapses the wave-like behavior into a definite outcome.",
      "- Modern interpretations connect this to information and observation.",
    ].join("\n");

    const lessonNotePayload = JSON.stringify({
      title: "Wave-Particle Duality",
      contentMarkdown: lessonNoteMarkdown,
      sourceRefs: [sourceRef],
    });

    const mocks = await installAiMocks(page, {
      chatResponders: [
        {
          label: "curriculum",
          match: isCurriculumRequest,
          textChunks: chunkifyText(curriculumPayload, 6),
          inputTokens: 800,
          outputTokens: 220,
        },
        {
          label: "lesson-note",
          match: isLessonNoteRequest,
          textChunks: chunkifyText(lessonNotePayload, 6),
          inputTokens: 600,
          outputTokens: 160,
        },
      ],
    });

    // ───── Step 1: open the curriculum generate modal ─────────────────────
    // NOTE: unreachable today (see test.skip above) — the /plan route was
    // removed and GenerateCurriculumModal is mounted on no page. Kept as the
    // spec for when curriculum generation regains a UI entry point.
    await page.goto(`/w/${seed.workspaceId}`);
    await page.waitForLoadState("networkidle");

    // The overview CTA renders both as the "Müfredat oluştur" / "Build
    // curriculum" button and as the empty-state "Taslak oluştur / Create
    // draft" button on the curriculum card — both call handleCreateDraft.
    // Match without anchors so future i18n tweaks (e.g. capitalization) don't
    // silently break the test.
    const openModalButton = page
      .getByRole("button", {
        name: /(müfredat oluştur|build curriculum|taslak oluştur|create draft)/i,
      })
      .first();
    await expect(openModalButton).toBeVisible({ timeout: 10_000 });
    await openModalButton.click();

    // ───── Step 2: Run AI curriculum generation ───────────────────────────
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const generateAiBtn = dialog.getByRole("button", {
      name: /ai ile oluştur|generate with ai/i,
    });
    await expect(generateAiBtn).toBeEnabled({ timeout: 5_000 });
    await generateAiBtn.click();

    // The runner persists items + closes the modal on success.
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    expect(mocks.responderHits("curriculum")).toBeGreaterThanOrEqual(1);

    // The "next topic" panel renders once the curriculum is on disk; it's
    // the cleanest single source of truth for "items got persisted".
    await expect(
      page.getByText(/wave-particle duality/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // ───── Step 3: Start the next topic → navigates to /study/[lessonId] ──
    const startTopicBtn = page.getByRole("button", {
      name: /konuya başla|start topic/i,
    });
    await startTopicBtn.click();
    await page.waitForURL(/\/study\/[^/]+(\?.*)?$/, { timeout: 10_000 });
    await page.waitForLoadState("networkidle");

    // ───── Step 4: AI regenerate (in-place update of the same noteId) ─────
    // The topbar "Yeniden üret" button opens the modal — but it's disabled
    // until `useCurriculumItem(note.curriculumItemId)` resolves, and the
    // modal itself is gated by `{item ? <RegenerateLessonModal /> : null}`,
    // so a click before the Dexie hook settles silently no-ops. Wait for
    // enabled state explicitly instead of racing against the page hydrate.
    const topbarRegenBtn = page
      .getByRole("button", { name: /yeniden üret|regenerate/i })
      .first();
    await expect(topbarRegenBtn).toBeEnabled({ timeout: 10_000 });
    await page.waitForTimeout(200);
    await clickTopbarButton(page, /yeniden üret|regenerate/i);

    const regenDialog = page.getByRole("dialog");
    await expect(regenDialog).toBeVisible({ timeout: 8_000 });
    const regenRunBtn = regenDialog.getByRole("button", {
      name: /yeniden üret|regenerate/i,
    });
    await regenRunBtn.click();

    await expect(regenDialog).toBeHidden({ timeout: 15_000 });
    expect(mocks.responderHits("lesson-note")).toBeGreaterThanOrEqual(1);

    // "double-slit experiment" appears only in the AI mock payload, not
    // the seeded chunks or heuristic draft, so it's the cleanest single
    // signal that the regenerate path replaced the note in place.
    await expect(
      page.getByText(/double-slit experiment/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // ───── Step 5: Edit mode → type → autosave fires ──────────────────────
    await clickTopbarButton(page, /^(düzenle|edit)$/i);
    const editor = page.getByTestId("lesson-note-editor");
    await expect(editor).toBeVisible({ timeout: 5_000 });

    const editedMarkdown = `${lessonNoteMarkdown}\n\n## My notes\n\nE2E user added this paragraph during the test run.`;
    await editor.fill(editedMarkdown);

    // The autosave debounce is 1s; allow a generous window for slow CI.
    const autosave = page.getByTestId("autosave-status");
    await expect(autosave).toContainText(/saved|kayde/i, {
      timeout: 8_000,
    });

    // Exit edit mode so the preview rerenders with the persisted content
    // — handleExitEdit flushes any pending debounce on the way out.
    await clickTopbarButton(page, /^(önizle|preview)$/i);
    await expect(page.getByText(/E2E user added this paragraph/i)).toBeVisible(
      { timeout: 5_000 },
    );

    // ───── Step 6: Q&A panel → fill + Save ────────────────────────────────
    // Placeholders are English literals in src (not i18n keys), so
    // matching them by attribute is stable across locale.
    const questionField = page.getByPlaceholder("Question");
    const answerField = page.getByPlaceholder("Answer");
    await questionField.fill("What does the double-slit experiment reveal?");
    await answerField.fill(
      "It reveals that individual quantum particles produce an interference pattern, demonstrating wave-like behavior.",
    );

    const saveQaBtn = page.getByRole("button", { name: /save q&a/i });
    await expect(saveQaBtn).toBeEnabled();
    await saveQaBtn.click();

    // The entry appears in the right-rail journal preview list (slice 0..3).
    await expect(
      page.getByText(/double-slit experiment reveal/i).first(),
    ).toBeVisible({ timeout: 5_000 });

    // ───── Step 7: PDF download ──────────────────────────────────────────
    const notePdfBtn = page.getByRole("button", { name: /note \.pdf/i });
    await expect(notePdfBtn).toBeEnabled();
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await notePdfBtn.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

    // Size is the only smoke we run on the artifact — visual fidelity is
    // out of scope for E2E. Use saveAs() to a temp path and stat it
    // because Playwright's download.path() can be flaky on Windows under
    // some sandbox configs.
    const path = await download.path();
    expect(path).toBeTruthy();
    if (path) {
      const fs = await import("node:fs/promises");
      const stat = await fs.stat(path);
      expect(stat.size).toBeGreaterThan(0);
    }
  });
});
