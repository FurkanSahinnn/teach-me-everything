import { describe, expect, it } from "vitest";
import { createReleaseManifest, validateReleaseAssets, validateReleaseConfig } from "./check-release.mjs";

const repository = "owner/repo";
const tag = "v1.2.3";
const config = {
  version: "1.2.3",
  bundle: { createUpdaterArtifacts: true },
  plugins: { updater: { pubkey: "public-key", endpoints: [`https://github.com/${repository}/releases/latest/download/latest.json`] } },
};
const assetNames = [
  "installer.msi", "installer.msi.sig", "installer.exe", "installer.exe.sig",
  "Teach Me Everything.AppImage", "Teach Me Everything.AppImage.sig",
  "installer.deb", "installer.deb.sig", "installer.rpm", "installer.rpm.sig",
];

function fixture() {
  return {
    release: { tag_name: tag, prerelease: false, draft: true, assets: ["latest.json", ...assetNames].map((name) => ({ name, size: 100 })) },
    manifest: createReleaseManifest(tag, repository, assetNames, () => "signature\n"),
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
    release.assets = release.assets.filter(({ name }) => name !== "installer.exe.sig");
    expect(() => validateReleaseAssets(release, manifest, repository, tag)).toThrow(/signature asset/);
    release.assets.push({ name: "installer.exe.sig", size: 100 });
    delete manifest.platforms["linux-x86_64"];
    expect(() => validateReleaseAssets(release, manifest, repository, tag)).toThrow(/platform/);
  });
  it("preserves MSI as the default Windows update and uses the AppImage for Linux", () => {
    const { manifest } = fixture();
    expect(manifest.platforms["windows-x86_64"]).toEqual(manifest.platforms["windows-x86_64-msi"]);
    expect(manifest.platforms["windows-x86_64-nsis"].url).toMatch(/installer\.exe$/);
    expect(manifest.platforms["linux-x86_64"]).toEqual({
      signature: "signature",
      url: `https://github.com/${repository}/releases/download/${tag}/Teach%20Me%20Everything.AppImage`,
    });
    expect(manifest.platforms["linux-x86_64-appimage"]).toEqual(manifest.platforms["linux-x86_64"]);
    expect(manifest.platforms["linux-x86_64-deb"].url).toMatch(/installer\.deb$/);
    expect(manifest.platforms["linux-x86_64-rpm"].url).toMatch(/installer\.rpm$/);
  });
  it("requires both Linux package formats and rejects a mismatched Linux updater URL", () => {
    const { release, manifest } = fixture();
    for (const extension of [".deb", ".rpm"]) {
      expect(() => createReleaseManifest(tag, repository, assetNames.filter((name) => !name.endsWith(extension)), () => "signature"))
        .toThrow(/Missing or ambiguous installer/);
    }
    manifest.platforms["linux-x86_64"] = manifest.platforms["windows-x86_64-msi"];
    expect(() => validateReleaseAssets(release, manifest, repository, tag)).toThrow(/platform linux-x86_64/);
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
