// Builds a minimal single-page PDF for the E2E ingest test. Hand-rolled
// bytes so we don't carry a `pdfkit` devDep just to author 3 lines of fixture
// content. Re-run `node tests/e2e/fixtures/build-pdf.mjs` after editing
// TEXT_LINES; commit the regenerated sample.pdf alongside this script.
//
// The output is a PDF 1.4 single-page document using the standard Helvetica
// Type1 font. pdfjs-dist v5 parses it cleanly because every required
// structure (catalog, pages, page, content stream, font, xref, trailer) is
// present and the xref offsets are byte-accurate.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "sample.pdf");

const TEXT_LINES = [
  "Quantum mechanics is the branch of physics describing the behavior",
  "of matter at atomic scales. The Heisenberg uncertainty principle",
  "states that position and momentum cannot both be precisely measured.",
];

function buildContentStream(lines) {
  let s = "BT\n/F1 14 Tf\n72 720 Td\n";
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) s += "0 -20 Td\n";
    s += `(${lines[i]}) Tj\n`;
  }
  s += "ET";
  return s;
}

const stream = buildContentStream(TEXT_LINES);
const streamBytes = Buffer.byteLength(stream, "latin1");

const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  `<< /Length ${streamBytes} >>\nstream\n${stream}\nendstream`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
];

// PDF spec §7.5.2 — header followed by a comment line containing four
// non-ASCII bytes flags the file as binary so transport layers preserve it.
const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1");

const partsList = [header];
const offsets = [];
let pos = header.length;

for (let i = 0; i < objects.length; i++) {
  offsets.push(pos);
  const objStr = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  const buf = Buffer.from(objStr, "latin1");
  partsList.push(buf);
  pos += buf.length;
}

const xrefOffset = pos;

let xref = `xref\n0 ${objects.length + 1}\n`;
xref += "0000000000 65535 f \n";
for (const off of offsets) {
  xref += `${String(off).padStart(10, "0")} 00000 n \n`;
}
xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
partsList.push(Buffer.from(xref, "latin1"));

const out = Buffer.concat(partsList);
writeFileSync(OUT, out);
// eslint-disable-next-line no-console
console.log(`Wrote ${OUT} (${out.length} bytes)`);
