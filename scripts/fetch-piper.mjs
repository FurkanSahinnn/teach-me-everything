#!/usr/bin/env node
// Phase 11.A automation: download the platform-specific Piper TTS engine
// distribution and place its FULL folder under
//   src-tauri/binaries/piper-<rust-target-triple>/
//
// Piper isn't a single static binary — the Windows release ships
// `piper.exe` plus `onnxruntime.dll`, `espeak-ng.dll`,
// `piper_phonemize.dll`, `libtashkeel_model.ort`, and the
// `espeak-ng-data/` dictionary. macOS/Linux mirror this with .dylib/.so
// equivalents. The engine only loads when those companions sit next to
// the executable, so we preserve the upstream folder layout and ship it
// to Tauri's resource directory via `bundle.resources` in
// `src-tauri/tauri.conf.json`. At runtime, `tts.rs` resolves
// `BaseDirectory::Resource` + `binaries/piper-<triple>/piper[.exe]` and
// spawns from inside that folder so the OS loader picks the DLLs up.
//
// Idempotent — exits fast if the binary is already present. Runs via the
// `postinstall` hook (so contributors and CI runners get it on
// `npm install`) and as a prefix to `tauri:dev` / `tauri:build`.
//
// Failure handling: on a non-CI machine exit 0 so a non-TTS contributor
// stays unblocked; in CI (`process.env.CI === "true"`) exit non-zero so a
// broken release build fails loudly instead of shipping without the
// engine.

import {
  existsSync,
  mkdirSync,
  chmodSync,
  rmSync,
  cpSync,
  createWriteStream,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// Pinned Piper release. When upstream cuts a new release, bump this and
// verify the asset filenames in `TARGETS` still match. The version is the
// GitHub tag without the leading "v".
const PIPER_VERSION = "2023.11.14-2";
const RELEASE_BASE = `https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}`;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(SCRIPT_DIR, "..");
const BINARIES_DIR = join(ROOT_DIR, "src-tauri", "binaries");

// `process.platform-process.arch`  →  release asset metadata.
//   archive = filename on the GitHub release
//   triple  = Rust target triple (used as the folder suffix)
//   exe     = name of the executable inside the extracted `piper/` folder
const TARGETS = {
  "win32-x64": {
    archive: "piper_windows_amd64.zip",
    triple: "x86_64-pc-windows-msvc",
    exe: "piper.exe",
  },
  "darwin-arm64": {
    archive: "piper_macos_aarch64.tar.gz",
    triple: "aarch64-apple-darwin",
    exe: "piper",
  },
  "darwin-x64": {
    archive: "piper_macos_x64.tar.gz",
    triple: "x86_64-apple-darwin",
    exe: "piper",
  },
  "linux-x64": {
    archive: "piper_linux_x86_64.tar.gz",
    triple: "x86_64-unknown-linux-gnu",
    exe: "piper",
  },
  "linux-arm64": {
    archive: "piper_linux_aarch64.tar.gz",
    triple: "aarch64-unknown-linux-gnu",
    exe: "piper",
  },
};

const IS_CI = process.env.CI === "true";

function log(msg) {
  console.log(`[fetch-piper] ${msg}`);
}

function warn(msg) {
  console.warn(`[fetch-piper] ! ${msg}`);
}

function fail(msg) {
  console.error(`[fetch-piper] x ${msg}`);
  process.exit(IS_CI ? 1 : 0);
}

async function downloadFile(url, destPath) {
  log(`downloading ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const total = Number(res.headers.get("content-length") ?? 0);
  let received = 0;
  let lastPct = -10;

  const reader = res.body.getReader();
  const out = createWriteStream(destPath);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      out.write(Buffer.from(value));
      if (total > 0) {
        const pct = Math.floor((received / total) * 100);
        if (pct - lastPct >= 10) {
          log(`  ${pct}%  (${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`);
          lastPct = pct;
        }
      }
    }
  } finally {
    out.end();
    await new Promise((resolve) => out.on("close", resolve));
  }
}

function extractArchive(archivePath, destDir) {
  log(`extracting ${basename(archivePath)}`);
  if (archivePath.endsWith(".zip")) {
    if (process.platform === "win32") {
      const r = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
        ],
        { stdio: "inherit" },
      );
      if (r.status !== 0) throw new Error("PowerShell Expand-Archive failed");
      return;
    }
    const r = spawnSync("unzip", ["-oq", archivePath, "-d", destDir], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("unzip failed");
    return;
  }
  // tar.gz — bsdtar on Win10+, GNU tar on macOS/Linux.
  const r = spawnSync("tar", ["-xzf", archivePath, "-C", destDir], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("tar -xzf failed");
}

async function main() {
  const platformKey = `${process.platform}-${process.arch}`;
  const target = TARGETS[platformKey];

  if (!target) {
    warn(`Platform ${platformKey} not in target map; skipping Piper download.`);
    warn(`TTS will be unavailable at runtime on this platform.`);
    return;
  }

  const finalDir = join(BINARIES_DIR, `piper-${target.triple}`);
  const piperExePath = join(finalDir, target.exe);

  if (existsSync(piperExePath)) {
    log(`already present: piper-${target.triple}/${target.exe} — skipping.`);
    return;
  }

  if (!existsSync(BINARIES_DIR)) {
    mkdirSync(BINARIES_DIR, { recursive: true });
  }

  const stagingDir = join(tmpdir(), `tme-piper-${Date.now()}`);
  mkdirSync(stagingDir, { recursive: true });

  try {
    const archivePath = join(stagingDir, target.archive);
    const archiveUrl = `${RELEASE_BASE}/${target.archive}`;

    await downloadFile(archiveUrl, archivePath);
    extractArchive(archivePath, stagingDir);

    // Every official Piper archive extracts a top-level `piper/` folder
    // containing the executable plus its companion shared libraries and
    // `espeak-ng-data/` dictionary.
    const extractedRoot = join(stagingDir, "piper");
    if (!existsSync(extractedRoot)) {
      throw new Error(
        `expected 'piper/' folder inside ${target.archive} but found none — ` +
          `upstream archive layout may have changed`,
      );
    }
    if (!existsSync(join(extractedRoot, target.exe))) {
      throw new Error(
        `expected '${target.exe}' inside the extracted piper/ folder — ` +
          `upstream layout may have changed`,
      );
    }

    if (existsSync(finalDir)) {
      rmSync(finalDir, { recursive: true, force: true });
    }
    // cpSync handles cross-device copies (tmp on another drive on Windows).
    cpSync(extractedRoot, finalDir, { recursive: true });

    if (process.platform !== "win32") {
      chmodSync(piperExePath, 0o755);
    }

    log(`OK installed piper-${target.triple}/  (engine + libs + espeak-ng-data)`);
  } catch (e) {
    fail(
      `${e instanceof Error ? e.message : String(e)}\n` +
        `  PIPER_VERSION may be stale or the asset name/layout changed.\n` +
        `  Edit scripts/fetch-piper.mjs and retry: node scripts/fetch-piper.mjs`,
    );
  } finally {
    try {
      rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

main();
