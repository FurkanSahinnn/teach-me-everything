# Piper Engine Distributions

This directory holds the platform-specific Piper TTS engine **folders**
that Tauri ships via `bundle.resources`. Each folder is the upstream
Piper release tree unmodified — the executable plus its companion
dynamic libraries and `espeak-ng-data/` dictionary, which the OS loader
finds via the binary's own directory at spawn time.

## Layout

```
src-tauri/binaries/
  piper-x86_64-pc-windows-msvc/
    piper.exe
    onnxruntime.dll
    onnxruntime_providers_shared.dll
    piper_phonemize.dll
    espeak-ng.dll
    libtashkeel_model.ort
    espeak-ng-data/
      en_dict, tr_dict, ... (~100 language dictionaries)
  piper-aarch64-apple-darwin/
    piper
    *.dylib
    libtashkeel_model.ort
    espeak-ng-data/
  ...
```

Each folder name is the Rust target triple of the host platform. At
runtime `tts.rs::piper_binary_path` resolves
`BaseDirectory::Resource + binaries/piper-<triple>/piper[.exe]`, which
points at the bundled resource directory in production and the source
folder in development.

## How they get here

They are **downloaded automatically** by `scripts/fetch-piper.mjs`:

- `npm install` runs it via the `postinstall` hook.
- `npm run tauri:dev` and `npm run tauri:build` run it again as a prefix
  (idempotent — exits fast if the folder is already present).
- CI (`.github/workflows/release.yml`) calls `npm ci` per platform job,
  which triggers the same `postinstall`, so every release artefact ships
  with its host platform's engine.

No manual download or placement is required. The folders themselves are
git-ignored (see `.gitignore` in this directory).

## Bundler wiring (already configured)

`src-tauri/tauri.conf.json` declares:

```jsonc
{
  "bundle": {
    "resources": ["binaries/piper-*/**/*"]
  }
}
```

The glob ships the whole per-platform folder structure to
`<app_resource_dir>/binaries/piper-<triple>/` in the installer, where
the Rust runtime resolves it. Tauri's `externalBin` mechanism is **not**
used here — it expects a single self-contained binary, and Piper
requires its adjacent libraries to load.

## Updating the Piper version

1. Edit `PIPER_VERSION` at the top of `scripts/fetch-piper.mjs`.
2. Delete the existing `piper-*/` folders from this directory.
3. Re-run `node scripts/fetch-piper.mjs` (or just `npm install`).

If the upstream archive layout changes (the top-level `piper/` folder
name or the executable name), update the corresponding `TARGETS` entry
in the script.

## Voice models are downloaded at runtime

The voice ONNX + JSON files are **not** bundled — they live under
`<appDataDir>/tts-models/piper/<voice-id>/` and are downloaded lazily on
first use via `Settings → Models → 🔊 TTS` or the `InstallModelModal`
that pops up during podcast generation. Removing a voice frees disk
without re-installing the engine folder.
