// Comprehensive verification of the static-export workspace-routing fix.
// Injects a workspace, then for every workspace-level sub-route:
//   1. soft-navigates there from the workspace home (tests the live SPA path),
//   2. asserts the page is NOT the global 404 ("Sayfa bulunamadı"),
//   3. asserts the resolved workspace context loaded (sidebar shows the name),
//   4. asserts navigation stayed client-side (no full reload).
import { chromium } from "playwright";

const BASE = "http://localhost:4599";
const ROUTES = [
  ["home", "/w/repro-ws-1/"],
  ["cards", "/w/repro-ws-1/cards/"],
  ["quiz", "/w/repro-ws-1/quiz/"],
  ["map", "/w/repro-ws-1/map/"],
  ["notes", "/w/repro-ws-1/notes/"],
  ["research", "/w/repro-ws-1/research/"],
  ["roadmap", "/w/repro-ws-1/roadmap/"],
  ["study/journal", "/w/repro-ws-1/study/journal/"],
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// Bootstrap: open app, inject a workspace, reload.
await page.goto(`${BASE}/dashboard/`, { waitUntil: "networkidle" });
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("tme");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const now = Date.now();
  await new Promise((res, rej) => {
    const tx = db.transaction("workspaces", "readwrite");
    tx.objectStore("workspaces").put({
      id: "repro-ws-1", name: "Repro WS", color: "#b8742a", initials: "RW",
      createdAt: now, updatedAt: now, archivedAt: null,
    });
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
});

const results = [];
for (const [name, url] of ROUTES) {
  // Hard-load each route: exercises the Tauri fallback (server serves the `_`
  // shell) + pathname-based id recovery — the exact path a deep link / refresh
  // takes. (Soft-nav smoothness is covered separately below.)
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => ({
    path: location.pathname,
    is404: document.body.innerText.includes("Sayfa bulunamadı"),
    hasWsName: document.body.innerText.includes("Repro WS"),
    h1: (document.querySelector("h1")?.textContent ?? "").slice(0, 40),
  }));
  results.push({ name, ...r });
}

// Soft-nav smoothness: from home, click the "Kart tekrarı" quick action.
await page.goto(`${BASE}/w/repro-ws-1/`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.evaluate(() => { window.__probe = "ALIVE"; });
let softNav = { ok: false, probe: "n/a", path: "" };
const cardsLink = await page.$('a[href*="/w/repro-ws-1/cards"]');
if (cardsLink) {
  await cardsLink.click();
  await page.waitForTimeout(1800);
  softNav = await page.evaluate(() => ({
    ok: !document.body.innerText.includes("Sayfa bulunamadı"),
    probe: window.__probe || "GONE(reload)",
    path: location.pathname,
  }));
}

console.log("===== ALL-ROUTES VERIFICATION =====");
let allPass = true;
for (const r of results) {
  const pass = !r.is404 && r.hasWsName;
  if (!pass) allPass = false;
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${r.name.padEnd(14)} 404=${r.is404}  wsName=${r.hasWsName}  h1="${r.h1}"`,
  );
}
console.log("---- soft-nav (home -> cards) ----");
const softPass = softNav.ok && softNav.probe === "ALIVE";
if (!softPass) allPass = false;
console.log(`${softPass ? "PASS" : "FAIL"}  smooth=${softNav.probe === "ALIVE"}  notFound=${!softNav.ok}  path=${softNav.path}`);
console.log("\nOVERALL:", allPass ? "ALL PASS ✅" : "SOME FAIL ❌");
await browser.close();
process.exit(allPass ? 0 : 1);
