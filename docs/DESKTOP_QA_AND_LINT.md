# Desktop QA and lint cleanup

Validation date: 2026-09-17. This completes the desktop verification and lint
follow-ups from the agent CLI review and Codex app-server implementation.

## Changes

Resolved the 53 ESLint errors without disabling rules. Changes include stable
listener callbacks updated after commit, guarded form resets, hydration-aware
vault rendering, and removal of render-time ref access. ChatBubble now preserves
hook ordering across message types; CitationChip uses a regular citationRef prop.
Analysis generation gets a fresh session when reopened, and PDF pagination uses
an explicit input draft rather than synchronizing state from an effect.

Three regression tests cover ChatBubble message-type changes, Modal callback
updates without focus loss, and SourceScopePicker closing when disabled.

## Actual Windows desktop checks

Built the native debug application with Cargo offline and exercised its real
WebView2 window using [Playwright CDP](https://playwright.dev/docs/webview2).
The application used an isolated WebView2 profile under ignored test-results
and a dedicated test workspace. Existing user workspace data was not used.

| Check | Result |
| --- | --- |
| Codex subscription-backed chat | Live response received |
| Cancel active response | Composer became usable again |
| Reload during active response | UI recovered; completed chat remained available |
| Native process cleanup after reload | No Codex child remained |
| Select model and save | Account-listed gpt-5.6-sol persisted across reload |
| Exit and reopen application | Conversation and provider/model choice persisted |
| Exit during active response | Application exited and observed Codex child terminated |

Live inference in this pass covered Codex only. Claude inference was not tested
because its quota was exhausted; the earlier installed-CLI launch check is not
a substitute for live Claude chat. The account model catalog superseded static
fallback choices during testing, so persistence was verified with a model
actually returned by that catalog.

The updater logged an unsuccessful endpoint response at startup. This remains
a separate follow-up; these checks do not validate release/update delivery.
Development logs also contained Tauri IPC fallback/reload callback warnings and
missing pricing entries for the tested models. Successful chat and cleanup
checks do not establish warning-free operation or accurate model pricing.

The test desktop instances and the development server started for this work
were stopped after verification.

## Automated validation

- Full repository ESLint: **0 errors, 88 warnings**. Warnings remain.
- TypeScript check: passed, including the new regression test files.
- Full Vitest run: **207 files, 2055 tests passed** before the three new tests.
- Focused regression run: **3 files, 3 tests passed** after adding those tests.
- Native debug build: passed with Cargo offline.
- Diff whitespace checks: passed.

No native source, routing, or build configuration changed in this cleanup.
Rust tests, static export, browser E2E, and macOS/Linux checks were not rerun.
The desktop checks used the development frontend, not a packaged release build.
