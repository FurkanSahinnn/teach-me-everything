import { expect, test } from "@playwright/test";
import { seedGuidedStudyWorkspace } from "./helpers/seed-state";

test("chat is reachable while the reader window is resized", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { workspaceId, sourceId } = await seedGuidedStudyWorkspace(page);
  await page.goto(`/w/${workspaceId}/read/${sourceId}`);

  const handle = page.getByRole("separator", { name: /yan panel genişliğini ayarla|resize side panel/i });
  await expect(handle).toBeVisible({ timeout: 15_000 });
  await page.setViewportSize({ width: 900, height: 900 });
  const chatTab = page.getByRole("radio", { name: /^(sohbet|chat)$/i });
  await chatTab.click();
  const composer = page.getByRole("textbox");
  await expect(composer).toBeVisible();
  await composer.fill("Keep this draft");

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(handle).toBeVisible();
  await expect(composer).toHaveValue("Keep this draft");
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error("Resize handle is missing");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 250, y, { steps: 10 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "300");
  await handle.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "316");

  await page.getByRole("button", { name: /yan paneli daralt|collapse side panel/i }).click();
  await expect(composer).toBeHidden();
  await page.getByRole("button", { name: /yan paneli aç|expand side panel/i }).click();
  await expect(handle).toHaveAttribute("aria-valuenow", "316");
  await expect(composer).toHaveValue("Keep this draft");

  const resizedHandle = await handle.boundingBox();
  if (!resizedHandle) throw new Error("Resize handle is missing after expanding the panel");
  await page.mouse.move(resizedHandle.x + resizedHandle.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(x - 450, y, { steps: 10 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "560");

  await page.setViewportSize({ width: 1050, height: 900 });
  await expect(handle).toBeVisible();
  await expect.poll(async () => Number(await handle.getAttribute("aria-valuenow"))).toBeLessThan(560);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(handle).toHaveAttribute("aria-valuenow", "560");
});

test("document notes save from the side panel and open in workspace Notes", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { workspaceId, sourceId, chunkIds } = await seedGuidedStudyWorkspace(page);
  await page.goto(`/w/${workspaceId}/read/${sourceId}`);

  const notesTab = page.getByRole("radio", { name: /^(notlar|notes)$/i });
  const document = page.locator(`#chunk-${chunkIds[0]}`);
  await notesTab.click({ timeout: 15_000 });
  await expect(document).toBeVisible();
  await page.getByRole("button", { name: /^(yeni not|new note)$/i }).click();
  const editor = page.getByTestId("note-editor-host").locator(".cm-content");
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("A saved observation");
  await expect(editor).toContainText("A saved observation");

  await page.setViewportSize({ width: 420, height: 840 });
  await expect(document).toBeHidden();
  await expect(editor).toBeVisible();
  await page.getByRole("radio", { name: /^(kaynak|source)$/i }).click();
  await expect(document).toBeVisible();
  await notesTab.click();
  await expect(editor).toContainText("A saved observation");

  await page.getByRole("link", { name: /notlar ekranında aç|open in notes/i }).click();
  await expect(page).toHaveURL(/\/notes\?id=/);
  await expect(editor).toContainText("A saved observation");
  await page.goto(`/w/${workspaceId}/read/${sourceId}?tab=notes`);
  await expect(editor).toContainText("A saved observation");
});
