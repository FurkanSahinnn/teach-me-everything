# Updater diagnosis and lint cleanup

Verified on 2026-09-17.

## Updater finding

The configured public endpoint is
`https://github.com/FurkanSahinnn/teach-me-everything/releases/latest/download/latest.json`.
GitHub's latest-release API returned HTTP 404. Authenticated release listing
found one release: **v1.0.0, draft**, release ID `335565701`, targeting commit
`e77ff4cfdf1037c3693ba7d36901214814b25414`. There is no published stable release
for the public updater to discover. Changing the endpoint would not fix this.

The draft contains latest.json, the Windows MSI and NSIS installers, and their
signature sidecars. The manifest version, platform entries, repository/tag URLs,
asset names, and exact signature-sidecar contents were checked successfully.
This is an asset consistency check, not cryptographic verification of installer
bytes or a packaged application smoke test.

The draft was **not published**, and no remote release or tag was changed.
It predates the current branch fixes; publishing it would not ship those fixes.
Until a stable release is published, the public updater remains unavailable.
Background checks still fail silently, while manual checks retain their error
state; a missing release is not misrepresented as "up to date".

The updater expects a publicly available static manifest with signed artifacts;
see the [official Tauri updater guide](https://v2.tauri.app/plugin/updater/).
Workflow input/output names were checked against the pinned major version's
[tauri-action v0 definition](https://github.com/tauri-apps/tauri-action/blob/v0/action.yml).

## Release preparation changes

- Manual workflow runs now require an explicit existing `vX.Y.Z` tag and check
  out that tag, instead of treating a branch name as the release tag.
- Preflight checks enforce matching npm/Tauri application versions, stable tag
  syntax, signed artifact generation, and the configured GitHub endpoint.
- After uploading, the workflow checks manifest/installer/signature consistency
  and explicitly reports that a draft is unavailable to the public updater.
- The workflow continues to create drafts for package verification before
  publication. The Rust crate version is independent of the Tauri app version
  and is not changed by these checks.

Commands from the repository root:

```powershell
# Offline configuration check (replace with the intended version):
node scripts/check-release.mjs v1.0.0
# Authenticated read-only check of existing draft assets (requires gh login):
node scripts/check-release.mjs v1.0.0 335565701
```

For a new release containing these changes, update package.json/package-lock.json
and the Tauri app version together, commit, then create the matching stable tag
at that commit. The tagged source must include the new check script. Verify
the generated package before publishing the draft. After publication, confirm
the public latest.json address responds and exercise the application's update
check. Workflow execution and real update installation were not performed in
this task.

## Lint changes and verification

ESLint went from **0 errors / 88 warnings** to **0 errors / 0 warnings** without
disabling rules. Six warnings originated in generated WebView2 test-profile
files; test-results and playwright-report are now excluded as generated output.
Source changes stabilize empty query results, fix callback/effect dependencies,
remove unused code and obsolete deferred unlock handlers, use unoptimized Image
components for small remote favicons, and expose tag selection through ARIA.

Embedding status probes now depend on an unambiguous serialized workspace ID
set. Equivalent list objects do not repeat probes; changed IDs do. Regression
tests cover that behavior and selected tag accessibility. Five release-check
tests cover version, platform, signature, and URL validation.

Validation:

- TypeScript: passed.
- Full repository ESLint: 0 errors, 0 warnings.
- Full Vitest run: 211 files / 2063 tests passed.
- Subsequently added UI regressions: 2 files / 3 tests passed.
- Static export: passed, all 26 pages generated. The initial sandbox attempt
  could not download Google Fonts; the approved network-enabled retry passed.
- Workflow YAML parsed successfully; native source/configuration was unchanged.
- Git diff whitespace checks passed.

No new Tauri installer build, Rust test run, live desktop session, or remote
GitHub Actions run was needed or performed for these frontend/workflow changes.
