# Agent CLI branch review — 2026-09-17

Scope: `feat/agent-cli`, from `80d0311` through `f13d6b1`, including the
unfinished review fixes present in the working tree. This report records the
review outcome; it is not a standing implementation plan.

## Corrections

- Native CLI lifecycle: drain output concurrently with stdin, avoid holding the
  session registry during writes, reject duplicate sessions, and terminate
  descendant processes on stop, application exit, and webview reload. Windows
  children start suspended and join a kill-on-close Job Object before resuming;
  Unix children use a process group. Probe processes also have bounded lifetimes.
- Native input boundaries: validate CLI entry names, inference arguments and
  environment overrides; reject arbitrary working-directory overrides. Use
  exclusive temporary prompt files and delete only the recorded file path.
  Configured local binaries and inherited environment remain trusted: filename
  validation does not authenticate an executable.
- Provider streams: handle pre-aborted requests and cancellation during startup,
  propagate Claude result errors, finish Codex replies on `turn.completed`, and
  retain usage before terminal failures without replaying tools. Keep Claude's
  requested subscription model alias in start events.
- Ingestion: bound oversized code lines, preserve matching Markdown fences and
  prose boundaries, and explicitly parse PDF/DOCX output as plain text. Correct
  footnote termination, mixed task lists, wikilink matching, and numeric outlines.
- Re-chunking: resolve each source's research credentials, preserve old chunks
  on failure/cancellation, and guard replacement against concurrent embedding.
  Re-embedding validates the original chunk snapshot before writing vectors.
  Settings now show failures and warn that existing chunk references can break.
- Source ordering: fix downward drops and bottom placement, add keyboard grip
  controls, retain hidden-source ordering, and report persistence failures.
- Settings and maintenance: ignore stale CLI probe results, use existing theme
  tokens, share JSON tool fallback logic, and exclude generated Rust output from
  ESLint. No lint rules were disabled.

## Validation

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run test:run` | 206 files, 2,058 tests passed |
| `cargo test --manifest-path src-tauri/Cargo.toml --offline` | 26 passed, 1 opt-in installed-Claude smoke test ignored |
| `npm.cmd run build:export` | Passed; initial restricted-network font fetch failed, approved network rerun succeeded |
| ESLint over the repository | 53 errors, 81 warnings remain |
| Lint baseline comparison against `main` | 53 changed/new JS/TS files checked; 6 errors before and after, no file gained errors |
| `git diff --check` | Passed |

The other lint errors are in files unchanged from `main`; the lint gate remains
red and needs a separate cleanup. Native tests exercised actual Node child and
grandchild processes on Windows, including pipe pressure and tree termination.
Authenticated CLI inference, manual Tauri flows, browser E2E, and macOS/Linux
runtime smoke tests were not run.

## Remaining limitations and next task

Re-chunking does not migrate saved chunk references; its warning is intentional,
not a claim that old citations remain valid. CLI model context limits remain
heuristic, and Codex `exec --json` still delivers complete messages rather than
incremental token streaming. CLI vision and session behavior remain provider
specific.

Next: manually smoke-test both providers in Tauri (detection, chat, cancellation,
reload/exit cleanup and model listing), then implement Codex app-server token
streaming using the existing native transport and provider contract.

The root `AGENTS.md` was separately checked and updated against the project. It
is ignored by the repository and is not included in this review commit.
