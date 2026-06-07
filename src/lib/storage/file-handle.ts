// File pick / blob download helpers. Prefers the modern File System Access
// API when available; falls back to a hidden <input type="file"> for browsers
// that do not implement showOpenFilePicker (Safari, Firefox).

type FilePickerOptions = {
  types?: { description: string; accept: Record<string, string[]> }[];
  multiple?: boolean;
};

interface FsaFileHandle {
  getFile(): Promise<File>;
}

interface FsaWindow {
  showOpenFilePicker?(opts?: FilePickerOptions): Promise<FsaFileHandle[]>;
}

function fsaWindow(): FsaWindow | null {
  if (typeof window === "undefined") return null;
  return window as unknown as FsaWindow;
}

export async function pickFile(accept: string): Promise<File | null> {
  const fsa = fsaWindow();
  if (fsa?.showOpenFilePicker) {
    try {
      const acceptMap: Record<string, string[]> = {};
      acceptMap["application/octet-stream"] = accept
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const handles = await fsa.showOpenFilePicker({
        types: [{ description: "Backup file", accept: acceptMap }],
        multiple: false,
      });
      const handle = handles[0];
      if (!handle) return null;
      return await handle.getFile();
    } catch (err) {
      // AbortError = user cancelled the picker; not an error worth surfacing.
      if (err instanceof DOMException && err.name === "AbortError") return null;
      // Fall through to the input fallback below.
    }
  }
  return await pickWithInput(accept);
}

function pickWithInput(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.position = "fixed";
    input.style.left = "-9999px";

    let settled = false;
    const finish = (value: File | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
      try {
        input.remove();
      } catch {
        /* noop */
      }
    };

    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0] ?? null;
        finish(file);
      },
      { once: true },
    );
    // 'cancel' fires on supporting browsers when the user closes the dialog.
    input.addEventListener("cancel", () => finish(null), { once: true });

    document.body.appendChild(input);
    input.click();
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") {
    throw new Error("downloadBlob requires a DOM environment");
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Defer revocation so Safari has a chance to flush the download stream.
  setTimeout(() => {
    try {
      a.remove();
    } catch {
      /* noop */
    }
    URL.revokeObjectURL(url);
  }, 0);
}
