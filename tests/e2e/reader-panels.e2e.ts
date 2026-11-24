import { expect, test, type Page } from "@playwright/test";
import { installAiMocks } from "./helpers/mock-ai-routes";
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
  await expect(handle).toHaveAttribute("aria-valuenow", "390");
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
  const maxWidth = Number(await handle.getAttribute("aria-valuemax"));
  expect(maxWidth).toBeGreaterThan(560);
  await page.mouse.move(resizedHandle.x + resizedHandle.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(x - 800, y, { steps: 10 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", String(maxWidth));

  await page.setViewportSize({ width: 1050, height: 900 });
  await expect(handle).toBeVisible();
  await expect.poll(async () => Number(await handle.getAttribute("aria-valuenow"))).toBeLessThan(maxWidth);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(handle).toHaveAttribute("aria-valuenow", String(maxWidth));
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

function pdfLines(pageNumber: number): [string, string, string] {
  return [
    `Page ${pageNumber}: Select this exact phrase.`,
    "This line belongs to the paragraph.",
    `Last paragraph line on page ${pageNumber}.`,
  ];
}

async function seedShortPagePdf(page: Page, sourceId: string, workspaceId?: string) {
  const pageCount = 6;
  const fontId = pageCount + 3;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`).join(" ")}] /Count ${pageCount} /MediaBox [0 0 612 210] >>`,
    ...Array.from({ length: pageCount }, (_, i) =>
      `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${fontId + 1 + i} 0 R >>`,
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    ...Array.from({ length: pageCount }, (_, i) => {
      const lines = pdfLines(i + 1).map((line) => `(${line}) Tj`).join("\n0 -26 Td\n");
      const stream = `BT /F1 20 Tf 130 Tz 48 164 Td\n${lines}\nET\n`;
      return `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
    }),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  await page.evaluate(async ({ sourceId, pdf, workspaceId }) => {
    const name = (await indexedDB.databases()).find((item) => item.name)?.name;
    if (!name) throw new Error("IndexedDB is missing");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(["sourceBlobs", "sources"], "readwrite");
        const blob = new Blob([pdf], { type: "application/pdf" });
        const now = Date.now();
        if (workspaceId) {
          transaction.objectStore("sources").put({
            id: sourceId, workspaceId, type: "pdf", title: "Second PDF",
            ingestStatus: "ready", createdAt: now, updatedAt: now,
          });
        }
        transaction.objectStore("sourceBlobs").put({
          sourceId, blob, contentType: blob.type, byteSize: blob.size, createdAt: now,
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  }, { sourceId, pdf, workspaceId });
}

test("each document restores its own reader settings after navigation and reload", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { workspaceId, sourceId, chunkIds } = await seedGuidedStudyWorkspace(page);
  const secondId = "src_e2e_second_reader_pdf";
  await seedShortPagePdf(page, sourceId);
  await seedShortPagePdf(page, secondId, workspaceId);
  const firstReader = `/w/${workspaceId}/read/${sourceId}`;
  const secondReader = `/w/${workspaceId}/read/${secondId}`;
  await page.goto(firstReader);

  const pdf = page.getByRole("radio", { name: /orijinal pdf|original pdf/i });
  const pageNumber = page.getByRole("textbox", { name: /sayfa numarası|page number/i });
  const zoom = page.getByRole("button", { name: /100% \(varsayılan\)|reset to 100%/i });
  const notes = page.getByRole("radio", { name: /^(notlar|notes)$/i });
  const handle = page.getByRole("separator", { name: /yan panel genişliğini ayarla|resize side panel/i });
  const collapse = page.getByRole("button", { name: /yan paneli daralt|collapse side panel/i });
  const expand = page.getByRole("button", { name: /yan paneli aç|expand side panel/i });
  const backToSources = page.getByRole("link", { name: /kaynaklara dön|back to sources/i });
  const appearance = page.getByRole("button", { name: /görünüm ayarları|appearance settings/i });
  const fullWidth = page.getByRole("radio", { name: /^(tam|full)$/i });
  const narrowWidth = page.getByRole("radio", { name: /^(dar|narrow)$/i });
  const fitWidth = page.getByRole("button", { name: /^(geniş|width)$/i });

  await appearance.click();
  await fullWidth.click();
  await pdf.click();
  await page.getByRole("button", { name: /yakınlaştır|zoom in/i }).click();
  await page.getByRole("button", { name: /döndür|rotate/i }).click();
  await pageNumber.fill("5");
  await pageNumber.press("Enter");
  await expect(pageNumber).toHaveValue("5");
  await expect(page.locator('[data-page-number="5"]')).toBeInViewport();
  await notes.click();
  await handle.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "406");
  await collapse.click();

  await backToSources.click();
  await page.locator(`a[href="${secondReader}"]`).first().click();
  await expect(pdf).toHaveAttribute("aria-checked", "false");
  await expect(handle).toHaveAttribute("aria-valuenow", "390");
  await appearance.click();
  await expect(narrowWidth).toHaveAttribute("aria-checked", "true");
  await pdf.click();
  await fitWidth.click();
  await handle.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "374");

  await backToSources.click();
  await page.locator(`a[href="${firstReader}"]`).first().click();
  await expect(pdf).toHaveAttribute("aria-checked", "true");
  await expect(zoom).toHaveText("150%");
  await expect(pageNumber).toHaveValue("5");
  await expect(page.locator('[data-page-number="5"]')).toBeInViewport();
  await expect(page.locator('[data-page-number="1"]')).toHaveAttribute("data-rotation", "90");
  await expand.click();
  await expect(handle).toHaveAttribute("aria-valuenow", "406");
  await expect(notes).toHaveAttribute("aria-checked", "true");

  await page.reload();
  await expect(handle).toHaveAttribute("aria-valuenow", "406");
  await expect(zoom).toHaveText("150%");
  await expect(notes).toHaveAttribute("aria-checked", "true");
  await appearance.click();
  await expect(fullWidth).toHaveAttribute("aria-checked", "true");

  await page.goto(`${firstReader}?chunk=${chunkIds[0]}`);
  await expect(pdf).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(`#chunk-${chunkIds[0]}`)).toBeVisible();
  await expect(notes).toHaveAttribute("aria-checked", "true");

  await backToSources.click();
  await page.locator(`a[href="${secondReader}"]`).first().click();
  await expect(handle).toHaveAttribute("aria-valuenow", "374");
  await expect(fitWidth).toHaveAttribute("aria-pressed", "true");

  await backToSources.click();
  await page.locator(`a[href="${firstReader}"]`).first().click();
  await expect(pdf).toHaveAttribute("aria-checked", "true");
  await expect(zoom).toHaveText("150%");
});

test("PDF page controls navigate precisely without moving the reader or Notes panel", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { workspaceId, sourceId } = await seedGuidedStudyWorkspace(page);
  await seedShortPagePdf(page, sourceId);
  await page.goto(`/w/${workspaceId}/read/${sourceId}?tab=notes`);
  await page.getByRole("radio", { name: /orijinal pdf|original pdf/i }).click({ timeout: 15_000 });
  const pageNumber = page.getByRole("textbox", { name: /sayfa numarası|page number/i });
  const previous = page.getByRole("button", { name: /önceki sayfa|previous page/i });
  const next = page.getByRole("button", { name: /sonraki sayfa|next page/i });
  const notes = page.getByRole("region", { name: /doküman notları|document notes/i });
  const pdfScroll = page.locator("[data-pdf-scroll]");
  await expect(notes).toBeVisible();
  await expect(pageNumber).toBeEnabled({ timeout: 20_000 });
  await expect(pdfScroll.locator("[data-page-number='6']")).toHaveCSS("height", "294px");
  const notesBounds = await notes.boundingBox();

  await pageNumber.fill("1");
  await pageNumber.press("Enter");
  await expect(pageNumber).toHaveValue("1");
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(pageNumber).toHaveValue("2");
  await next.click();
  await expect(pageNumber).toHaveValue("3");
  await previous.click();
  await expect(pageNumber).toHaveValue("2");

  await pageNumber.fill("6");
  await pageNumber.press("Enter");
  await expect(pageNumber).toHaveValue("6");
  await expect(next).toBeDisabled();
  await expect(pdfScroll.locator("[data-page-number='6']")).toBeInViewport();

  const zoomIn = page.getByRole("button", { name: /yakınlaştır|zoom in/i });
  await zoomIn.click();
  await zoomIn.click();
  const offset = await pdfScroll.evaluate((element) => {
    element.scrollLeft = 120;
    return element.scrollLeft;
  });
  expect(offset).toBeGreaterThan(0);
  await pageNumber.fill("3");
  await pageNumber.press("Enter");
  await expect(pageNumber).toHaveValue("3");
  expect(await pdfScroll.evaluate((element) => element.scrollLeft)).toBe(offset);

  await pageNumber.focus();
  await pdfScroll.evaluate((element) => { element.scrollTop = 0; });
  await expect(pageNumber).toHaveValue("1");
  await pageNumber.blur();
  expect(await pdfScroll.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await notes.boundingBox()).toEqual(notesBounds);
  expect(await page.locator("main").evaluate((element) => element.scrollTop)).toBe(0);

  await page.getByRole("button", { name: /100% \(varsayılan\)|reset to 100%/i }).click();
  const zoomOut = page.getByRole("button", { name: /uzaklaştır|zoom out/i });
  await zoomOut.click();
  await zoomOut.click();
  await expect(pdfScroll.locator("[data-page-number='1']")).toHaveCSS("width", "306px");

  const handle = page.getByRole("separator", { name: /yan panel genişliğini ayarla|resize side panel/i });
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error("Resize handle is missing");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 350, y, { steps: 10 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "740");
  expect(await pdfScroll.evaluate((element) => element.scrollWidth)).toBe(
    await pdfScroll.evaluate((element) => element.clientWidth),
  );

  await page.getByRole("button", { name: /100% \(varsayılan\)|reset to 100%/i }).click();
  await expect(pdfScroll.locator("[data-page-number='1']")).toHaveCSS("height", "210px");
  await pdfScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(pageNumber).toHaveValue("6");
  await page.reload();
  await expect(pageNumber).toHaveValue("6");
  await expect(pdfScroll.locator('[data-page-number="6"]')).toBeInViewport();
});

for (const type of ["md", "docx", "url"] as const) {
  test(`restores the reading position of an imported ${type} source`, async ({ page }) => {
    test.setTimeout(60_000);
    const { workspaceId, sourceId, chunkIds } = await seedGuidedStudyWorkspace(page);
    const readerUrl = `/w/${workspaceId}/read/${sourceId}`;
    const resumeChunk = "ck_reader_resume_12";
    await page.evaluate(async ({ workspaceId, sourceId, type }) => {
      const name = (await indexedDB.databases()).find((item) => item.name)?.name;
      if (!name) throw new Error("IndexedDB is missing");
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(["sources", "chunks"], "readwrite");
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          const sources = transaction.objectStore("sources");
          const request = sources.get(sourceId);
          request.onsuccess = () => sources.put({ ...request.result, type });

          const chunks = transaction.objectStore("chunks");
          for (let index = 3; index < 20; index++) {
            chunks.put({
              id: `ck_reader_resume_${index}`, workspaceId, sourceId, index,
              text: Array.from({ length: 7 }, (_, line) =>
                `Paragraph ${line + 1} in section ${index}. ${"Reading position example. ".repeat(8)}`,
              ).join("\n\n"),
              tokenCount: 100, createdAt: Date.now(),
            });
          }
        });
      } finally {
        db.close();
      }
    }, { workspaceId, sourceId, type });
    await page.goto(readerUrl);
    const chunk = page.locator(`#chunk-${resumeChunk}`);
    const offsetFromViewport = () => chunk.evaluate((element) => {
      const viewport = element.closest("[data-reader-scroll]");
      if (!viewport) throw new Error("Reading area is missing");
      return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    });
    await chunk.scrollIntoViewIfNeeded();
    await chunk.hover();
    await page.mouse.wheel(0, 64);
    await expect(chunk).toBeInViewport();
    const offset = await chunk.evaluate(async (element) => {
      const viewport = element.closest("[data-reader-scroll]");
      if (!viewport) throw new Error("Reading area is missing");
      const measure = () => element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      let position = measure();
      let settledFrames = 0;
      // Wait for wheel scrolling and content-visibility measurements to settle.
      for (let frame = 0; frame < 120 && settledFrames < 8; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const current = measure();
        settledFrames = Math.abs(current - position) < 1 ? settledFrames + 1 : 0;
        position = current;
      }
      return position;
    });

    await page.getByRole("link", { name: /kaynaklara dön|back to sources/i }).click();
    await page.locator(`a[href="${readerUrl}"]`).first().click();
    await expect(chunk).toBeInViewport();
    await expect.poll(async () => Math.abs(await offsetFromViewport() - offset)).toBeLessThan(8);
    await page.reload();
    await expect(chunk).toBeInViewport();
    await expect.poll(async () => Math.abs(await offsetFromViewport() - offset)).toBeLessThan(8);

    await page.goto(`${readerUrl}?chunk=${chunkIds[0]}`);
    await expect(page.locator(`#chunk-${chunkIds[0]}`)).toBeInViewport();
  });
}

test("original PDF text follows the pointer and can be quoted in chat", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1760, height: 1100 });
  const phrase = "Select this exact phrase.";
  const question = "What does this PDF passage mean?";
  const mocks = await installAiMocks(page, {
    chatResponders: [{
      label: "pdf quote",
      match: ({ messages }) => {
        const content = JSON.stringify(messages);
        return content.includes(phrase) && content.includes(question);
      },
      textChunks: ["I can explain that passage."],
    }],
  });
  const { workspaceId, sourceId } = await seedGuidedStudyWorkspace(page);
  await seedShortPagePdf(page, sourceId);
  await page.goto(`/w/${workspaceId}/read/${sourceId}?tab=notes`);
  await page.getByRole("radio", { name: /orijinal pdf|original pdf/i }).click({ timeout: 15_000 });

  const first = page.locator('[data-page-number="1"]');
  const second = page.locator('[data-page-number="2"]');
  const lines = pdfLines(1);
  const nextLines = pdfLines(2);
  await expect(first.locator(".textLayer")).toContainText(lines[0]);
  await expect(second.locator(".textLayer")).toContainText(nextLines[0]);
  const firstLine = lines[0];

  async function point(pdfPage: typeof first, column: number, line: number, rotated = false) {
    const box = await pdfPage.boundingBox();
    if (!box) throw new Error("PDF page is unavailable");
    // Courier at 20pt with 130% horizontal scaling advances 15.6 PDF units.
    const x = 48 + column * 15.6;
    const y = 39 + line * 26;
    return rotated
      ? { x: box.x + (210 - y) * box.width / 210, y: box.y + x * box.height / 612 }
      : { x: box.x + x * box.width / 612, y: box.y + y * box.height / 210 };
  }

  async function select(from: { x: number; y: number }, to: { x: number; y: number }) {
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 16 });
    await page.mouse.up();
    return (await page.evaluate(() => window.getSelection()?.toString() ?? "")).trim();
  }

  const start = firstLine.indexOf(phrase) + 0.1;
  const finish = firstLine.length - 0.1;
  expect(await select(await point(first, start, 0), await point(first, finish, 0))).toBe(phrase);

  const end = lines[2].length - 0.1;
  expect(await select(await point(first, end, 2), await point(first, 0.1, 0))).toBe(lines.join("\n"));
  const acrossPages = await select(await point(first, 0.1, 2), await point(second, nextLines[0].length - 0.1, 0));
  expect(acrossPages.replace(/\s+/g, " ")).toBe(`${lines[2]} ${nextLines[0]}`);

  await page.getByRole("button", { name: /yakınlaştır|zoom in/i }).click();
  await expect(first).toHaveCSS("width", "918px");
  await expect(first.locator(".textLayer")).toContainText(phrase);
  expect(await select(await point(first, start, 0), await point(first, finish, 0))).toBe(phrase);

  await page.getByRole("button", { name: /döndür|rotate/i }).click();
  await expect(first).toHaveCSS("width", "315px");
  await expect(first.locator(".textLayer")).toContainText(phrase);
  expect(await select(await point(first, start, 0, true), await point(first, finish, 0, true))).toBe(phrase);

  const askBar = page.getByRole("toolbar", { name: /seçim aksiyonları|selection actions/i });
  await expect(askBar).toBeVisible();
  await askBar.getByRole("button", { name: /bunu sor|ask about this/i }).click();
  await expect(askBar).toBeHidden();
  await expect(page.getByRole("radio", { name: /^(sohbet|chat)$/i })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: /alıntıyı kaldır|remove quote/i })).toBeVisible();
  await expect(page.getByText(`“${phrase}”`, { exact: true })).toBeVisible();
  expect(mocks.chatHits()).toBe(0);

  const composer = page.locator("textarea");
  await expect(composer).toBeFocused();
  await composer.fill(question);
  await composer.press("Enter");
  await expect(page.getByText("I can explain that passage.")).toBeVisible();
  expect(mocks.responderHits("pdf quote")).toBe(1);
});
