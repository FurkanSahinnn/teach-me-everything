import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const updaterInstallers = {
  "windows-x86_64": ".msi",
  "windows-x86_64-msi": ".msi",
  "windows-x86_64-nsis": ".exe",
  "linux-x86_64": ".AppImage",
  "linux-x86_64-appimage": ".AppImage",
  "linux-x86_64-deb": ".deb",
  "linux-x86_64-rpm": ".rpm",
};

function findInstaller(names, extension) {
  const installers = [...names].filter((name) => name.endsWith(extension));
  assert.equal(installers.length, 1, `Missing or ambiguous installer ending in ${extension}`);
  return installers[0];
}

export function createReleaseManifest(tag, repository, names, readSignature, notes) {
  const platforms = Object.fromEntries(
    Object.entries(updaterInstallers).map(([platform, extension]) => {
      const name = findInstaller(names, extension);
      return [platform, {
        url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`,
        signature: readSignature(`${name}.sig`).trim(),
      }];
    }),
  );
  const manifest = { version: tag.slice(1), notes, platforms };
  const assets = ["latest.json", ...names].map((name) => ({ name, size: 1 }));
  validateReleaseAssets({ tag_name: tag, prerelease: false, assets }, manifest, repository, tag);
  return manifest;
}

export function validateReleaseConfig(tag, config, packageVersion) {
  assert.match(tag, /^v\d+\.\d+\.\d+$/, "Release tag must be a stable vX.Y.Z tag");
  assert.equal(config.version, tag.slice(1), "Tag and Tauri app version differ");
  assert.equal(packageVersion, config.version, "Package and Tauri app version differ");
  assert.equal(config.bundle.createUpdaterArtifacts, true, "Signed updater artifacts must be enabled");
  const endpoint = config.plugins.updater.endpoints[0];
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/latest\/download\/latest\.json$/.exec(endpoint);
  assert.ok(match, "Expected a GitHub Releases latest.json endpoint");
  assert.ok(config.plugins.updater.pubkey, "Updater public key is missing");
  return match[1];
}

export function validateReleaseAssets(release, manifest, repository, tag) {
  assert.equal(release.tag_name, tag, "Release tag differs from requested tag");
  assert.equal(release.prerelease, false, "Stable updater cannot use a prerelease");
  assert.equal(manifest.version, tag.slice(1), "Manifest version differs from release tag");
  const names = new Set(release.assets.filter((asset) => asset.size > 0).map((asset) => asset.name));
  assert.ok(names.has("latest.json"), "Release is missing latest.json");
  for (const [platform, extension] of Object.entries(updaterInstallers)) {
    const entry = manifest.platforms?.[platform];
    assert.ok(entry, `Missing updater platform: ${platform}`);
    assert.ok(typeof entry.signature === "string" && entry.signature.trim(), `Missing signature: ${platform}`);
    const url = new URL(entry.url);
    const prefix = `/${repository}/releases/download/${tag}/`;
    assert.equal(url.origin, "https://github.com", "Unexpected installer host");
    assert.ok(url.pathname.startsWith(prefix), "Installer belongs to another repository or tag");
    assert.equal(url.search + url.hash, "", "Installer URL must not contain a query or fragment");
    const name = decodeURIComponent(url.pathname.slice(prefix.length));
    assert.equal(name, findInstaller(names, extension), `Unexpected installer for platform ${platform}`);
    assert.ok(names.has(name), `Missing installer asset: ${name}`);
    assert.ok(names.has(`${name}.sig`), `Missing signature asset: ${name}`);
  }
}

function github(path, binary = false) {
  return execFileSync("gh", ["api", path, ...(binary ? ["-H", "Accept: application/octet-stream"] : [])], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024,
  });
}

function main() {
  const [tag, releaseId, directory, notesFile] = process.argv.slice(2);
  const config = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const repository = validateReleaseConfig(tag, config, pkg.version);
  if (releaseId === "--prepare") {
    const names = readdirSync(directory)
      .filter((name) => name !== "latest.json")
      .filter((name) => {
        const stats = statSync(resolve(directory, name));
        return stats.isFile() && stats.size > 0;
      });
    const manifest = createReleaseManifest(
      tag, repository, names,
      (name) => readFileSync(resolve(directory, name), "utf8"),
      readFileSync(notesFile, "utf8"),
    );
    writeFileSync(resolve(directory, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
    return;
  }
  if (!releaseId) {
    console.log(`Release configuration valid for ${tag}.`);
    return;
  }
  assert.match(releaseId, /^\d+$/, "Release ID must be numeric");
  const release = JSON.parse(github(`repos/${repository}/releases/${releaseId}`));
  const asset = release.assets.find((item) => item.name === "latest.json");
  assert.ok(asset, "Release is missing latest.json");
  const manifest = JSON.parse(github(`repos/${repository}/releases/assets/${asset.id}`, true));
  validateReleaseAssets(release, manifest, repository, tag);
  for (const entry of Object.values(manifest.platforms)) {
    const name = decodeURIComponent(new URL(entry.url).pathname.split("/").at(-1));
    const signature = release.assets.find((item) => item.name === `${name}.sig`);
    assert.ok(signature, `Missing signature file for ${name}`);
    assert.equal(github(`repos/${repository}/releases/assets/${signature.id}`, true).trim(), entry.signature.trim(),
      `Manifest signature differs from signature asset: ${name}`);
  }
  console.log(`Release assets and signature files match for ${tag}. This does not cryptographically verify installer bytes.`);
  console.log(release.draft
    ? "DRAFT: the public updater endpoint will remain unavailable until this release is published."
    : "Published release: verify the public latest.json endpoint before announcing update availability.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
