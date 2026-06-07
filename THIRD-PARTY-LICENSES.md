# Third-Party Licenses

Teach Me Everything is licensed under the [MIT License](LICENSE). The
application **source** depends only on permissive (MIT / ISC / Apache-2.0 /
BSD) packages.

The distributed **desktop binary** (Tauri, via GitHub Releases) additionally
bundles a local text-to-speech engine and its runtime. These prebuilt
binaries are fetched at build time and are **not** part of this source
repository, but they ship inside the released installers, so their licenses
are reproduced/attributed here.

## Bundled in the desktop binary

| Component | Purpose | License |
| --- | --- | --- |
| [Piper](https://github.com/rhasspy/piper) | Neural text-to-speech engine | MIT |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | Model inference runtime used by Piper | MIT |
| [espeak-ng](https://github.com/espeak-ng/espeak-ng) | Text-to-phoneme front-end used by Piper (`espeak-ng.dll` + `espeak-ng-data/`) | **GPL-3.0-or-later** |

### Note on espeak-ng (GPL-3.0)

`espeak-ng` is licensed under the **GNU General Public License, version 3 or
later**. It is bundled, unmodified, as a separate dynamic library
(`espeak-ng.dll` and its data directory) alongside the application — it is an
aggregate distribution and does not relicense Teach Me Everything's own
MIT-licensed code.

In accordance with the GPL-3.0, the complete corresponding source code for the
bundled `espeak-ng` build is available from the upstream project:

- https://github.com/espeak-ng/espeak-ng

The full text of the GNU General Public License v3.0 is available at
<https://www.gnu.org/licenses/gpl-3.0.txt>.

## Fonts

The UI uses Geist, Geist Mono, JetBrains Mono and Source Serif 4, loaded via
`next/font` from Google Fonts. These fonts are distributed under the SIL Open
Font License 1.1 / Apache License 2.0.

## JavaScript / Rust dependencies

The full dependency trees and their licenses are described by `package-lock.json`
(npm) and `src-tauri/Cargo.lock` (Cargo). All direct dependencies use
permissive licenses; run `npx license-checker` (or `cargo about`) to regenerate
a complete manifest.
