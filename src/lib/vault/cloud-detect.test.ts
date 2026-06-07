import { describe, it, expect } from "vitest";
import { detectCloudSyncFolder } from "./cloud-detect";

describe("detectCloudSyncFolder", () => {
  it("returns no detection for plain paths", () => {
    expect(detectCloudSyncFolder("/home/alice/notes")).toEqual({
      detected: false,
      hint: null,
    });
    expect(
      detectCloudSyncFolder("C:\\Users\\Alice\\Documents\\TME"),
    ).toEqual({ detected: false, hint: null });
  });

  it("detects Dropbox on POSIX", () => {
    const out = detectCloudSyncFolder("/Users/alice/Dropbox/notes");
    expect(out.detected).toBe(true);
    expect(out.hint).toBe("Dropbox");
  });

  it("detects Dropbox on Windows", () => {
    const out = detectCloudSyncFolder("C:\\Users\\Alice\\Dropbox\\notes");
    expect(out.detected).toBe(true);
    expect(out.hint).toBe("Dropbox");
  });

  it("detects iCloud Drive (macOS spelling)", () => {
    expect(
      detectCloudSyncFolder("/Users/alice/iCloud Drive/notes").detected,
    ).toBe(true);
  });

  it("detects macOS iCloud mobile documents path", () => {
    expect(
      detectCloudSyncFolder(
        "/Users/alice/Library/Mobile Documents/com~apple~CloudDocs/notes",
      ).detected,
    ).toBe(true);
  });

  it("detects OneDrive", () => {
    expect(
      detectCloudSyncFolder("C:\\Users\\Alice\\OneDrive\\notes").detected,
    ).toBe(true);
  });

  it("detects Google Drive (both spellings)", () => {
    expect(
      detectCloudSyncFolder("/Users/alice/Google Drive/notes").detected,
    ).toBe(true);
    expect(
      detectCloudSyncFolder("/Users/alice/GoogleDrive/notes").detected,
    ).toBe(true);
  });

  it("does NOT trigger on unrelated names containing the substring", () => {
    // `MyDropboxBackup` contains "Dropbox" but isn't a cloud sync folder.
    expect(
      detectCloudSyncFolder("/Users/alice/MyDropboxBackup/notes").detected,
    ).toBe(false);
    expect(
      detectCloudSyncFolder("/Users/alice/NotOneDriveAtAll/notes").detected,
    ).toBe(false);
  });

  it("matches case-insensitive", () => {
    expect(
      detectCloudSyncFolder("/Users/alice/dropbox/notes").detected,
    ).toBe(true);
  });

  it("handles empty + non-string defensively", () => {
    expect(detectCloudSyncFolder("").detected).toBe(false);
  });
});
