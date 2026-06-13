// Throwaway static server to reproduce Tauri's static-export serving behavior.
// Serves ../out faithfully: exact file → dir/index.html → 404 (no SPA fallback),
// mirroring Tauri 2's asset protocol so we can test client-side SPA navigation
// to a non-prerendered /w/<id> route.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "out");
const PORT = 4599;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function tryFile(p) {
  try {
    const s = await stat(p);
    if (s.isFile()) return p;
    if (s.isDirectory()) {
      const idx = join(p, "index.html");
      const si = await stat(idx);
      if (si.isFile()) return idx;
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);
  const candidate = join(ROOT, pathname);

  let file = await tryFile(candidate);

  // EXPERIMENT: SPA fallback for the /w/<id>/... subtree. Replace the runtime
  // workspace id (2nd segment) and deep dynamic ids with the `_` shell that
  // static export actually emitted, then retry. Mirrors what a Tauri
  // resource-request interceptor would do. Only applied to HTML navigations
  // (not the *.txt RSC fetches, which we want to keep 404ing to observe the
  // hard-nav fallback — but for the shell test we DO rewrite html).
  if (!file && pathname.startsWith("/w/")) {
    const segs = pathname.split("/").filter(Boolean); // ["w","<id>","cards",...]
    if (segs.length >= 2) {
      segs[1] = "_"; // workspace id
      const DYN_PARENTS = new Set(["roadmap", "read", "study", "audio"]);
      for (let i = 2; i < segs.length - 1; i++) {
        const parent = segs[i];
        const child = segs[i + 1];
        if (DYN_PARENTS.has(parent) && !(parent === "study" && child === "journal")) {
          segs[i + 1] = "_";
        }
      }
      const rewritten = "/" + segs.join("/");
      file = await tryFile(join(ROOT, rewritten));
      if (file) console.log(`REWRITE ${pathname}  ->  ${rewritten}`);
    }
  }

  if (!file) {
    // Faithful to Tauri: missing path → 404 (NOT a SPA fallback to index.html).
    const notFound = await tryFile(join(ROOT, "404.html"));
    res.statusCode = 404;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(notFound ? await readFile(notFound) : "404");
    console.log(`404  ${pathname}`);
    return;
  }

  res.statusCode = 200;
  res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
  res.end(await readFile(file));
  console.log(`200  ${pathname}  ->  ${file.slice(ROOT.length)}`);
});

server.listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
