import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const tagPattern = /^v\d+\.\d+\.\d+$/;
const packagePath = "package.json";
const lockPath = "package-lock.json";
const tauriPath = "src-tauri/tauri.conf.json";
const cargoPath = "src-tauri/Cargo.toml";
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const [applyTag] = process.argv.slice(2);

if (applyTag) {
  if (!tagPattern.test(applyTag)) throw new Error("Release tag must be vX.Y.Z");
  const version = applyTag.slice(1);
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const config = JSON.parse(readFileSync(tauriPath, "utf8"));
  pkg.version = lock.version = lock.packages[""].version = config.version = version;
  for (const [path, data] of [[packagePath, pkg], [lockPath, lock], [tauriPath, config]]) {
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  }
  const manifest = readFileSync(cargoPath, "utf8").replace(/^(version\s*=\s*)"[^"]*"/m, `$1"${version}"`);
  writeFileSync(cargoPath, manifest);
} else {
  const requestedTag = process.env.REQUESTED_TAG;
  const baseTag = requestedTag || `v${pkg.version}`;
  if (!tagPattern.test(baseTag)) throw new Error("Release tag must be vX.Y.Z");

  const gitTags = execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" });
  const releaseTags = execFileSync("gh", [
    "api", `repos/${process.env.GITHUB_REPOSITORY}/releases?per_page=100`,
    "--paginate", "--jq", ".[].tag_name",
  ], { encoding: "utf8" });
  const releases = new Set(releaseTags.trim().split(/\r?\n/));
  if (requestedTag && releases.has(baseTag)) {
    throw new Error(`A GitHub release already exists for ${baseTag}`);
  }

  const taken = new Set([...gitTags.trim().split(/\r?\n/), ...releases]);
  const [major, minor, basePatch] = baseTag.slice(1).split(".").map(Number);
  let tag = baseTag;
  if (!requestedTag) {
    let patch = basePatch;
    while (taken.has(tag)) tag = `v${major}.${minor}.${++patch}`;
  }
  console.log(tag);
}
