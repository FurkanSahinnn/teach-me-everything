import { describe, expect, it } from "vitest";
import { validateReleaseAssets, validateReleaseConfig } from "./check-release.mjs";

const repository = "owner/repo";
const tag = "v1.2.3";
const config = {
  version: "1.2.3",
  bundle: { createUpdaterArtifacts: true },
  plugins: { updater: { pubkey: "public-key", endpoints: [`https://github.com/${repository}/releases/latest/download/latest.json`] } },
};
function fixture() {
  const entry = { signature: "signature", url: `https://github.com/${repository}/releases/download/${tag}/installer.exe` };
  return {
    release: { tag_name: tag, prerelease: false, draft: true, assets: ["latest.json", "installer.exe", "installer.exe.sig"].map((name) => ({ name, size: 100 })) },
    manifest: { version: "1.2.3", platforms: Object.fromEntries(["windows-x86_64", "windows-x86_64-msi", "windows-x86_64-nsis"].map((platform) => [platform, { ...entry }])) },
  };
}

describe("release checks", () => {
  it("accepts matching stable app versions and rejects branch names or mismatched versions", () => {
    expect(validateReleaseConfig(tag, config, "1.2.3")).toBe(repository);
    expect(() => validateReleaseConfig("main", config, "1.2.3")).toThrow();
    expect(() => validateReleaseConfig("v1.2.4", config, "1.2.3")).toThrow();
    expect(() => validateReleaseConfig(tag, config, "1.0.0")).toThrow();
  });
  it("allows inspection of a complete draft without publishing it", () => {
    const { release, manifest } = fixture();
    expect(() => validateReleaseAssets(release, manifest, repository, tag)).not.toThrow();
  });
  it("rejects missing artifacts and incomplete platform manifests", () => {
    const { release, manifest } = fixture();
    release.assets.pop();
    expect(() => validateReleaseAssets(release, manifest, repository, tag)).toThrow(/signature asset/);
    delete manifest.platforms["windows-x86_64"];
    expect(() => validateReleaseAssets(release, manifest, repository, tag)).toThrow(/platform/);
  });
  it("rejects an installer from another tag or repository", () => {
    const { release, manifest } = fixture();
    manifest.platforms["windows-x86_64"].url = "https://github.com/other/repo/releases/download/v1.2.3/installer.exe";
    expect(() => validateReleaseAssets(release, manifest, repository, tag)).toThrow(/repository or tag/);
  });
  it("rejects unsigned entries and prereleases on the stable channel", () => {
    const { release, manifest } = fixture();
    manifest.platforms["windows-x86_64"].signature = "";
    expect(() => validateReleaseAssets(release, manifest, repository, tag)).toThrow(/signature/);
    release.prerelease = true;
    expect(() => validateReleaseAssets(release, manifest, repository, tag)).toThrow(/prerelease/);
  });
});
