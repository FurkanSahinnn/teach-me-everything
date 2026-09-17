# Codex app-server streaming

The desktop Codex provider uses `codex app-server` over the existing native
`agent_cli_start` / `agent_cli_write` / `agent_cli_stop` bridge. There is no
Next.js API dependency. Validated with installed codex-cli 0.154.0 on Windows.

## Request lifecycle

`codex-app-server.ts` waits for initialization, acknowledges it, creates an
ephemeral read-only thread with approval policy `never`, then starts one turn.
TME system text becomes the thread's base instructions; flattened conversation
history travels as text input over stdin. Each TME request gets a new process
and thread. TME retains responsibility for conversation persistence.

Agent message deltas immediately become shared text events. Completed items
provide a fallback for non-delta output without repeating already streamed
text. Thread totals supply usage, with cached input separated from ordinary
input. Completion, interruption, retryable errors and terminal errors have
distinct outcomes. TME's JSON tool translator remains in use.

Handshake stages have a 20-second timeout. Cancellation, consumer teardown,
errors and completion stop the owned process tree. Unsupported server requests
receive an explicit error and terminate the TME turn instead of hanging.

The message shapes were checked against the installed CLI's generated protocol
types and the [official app-server documentation](https://developers.openai.com/codex/app-server/).

## Configuration and limitations

App-server loads the user's trusted local Codex configuration. Unlike `exec`,
it does not accept `--ignore-user-config` or `--ignore-rules`. This integration
overrides the thread's instructions, persistence and sandbox/approval policy;
it does not claim to isolate the CLI installation, inherited environment or
locally configured integrations. TME does not implement app-server approval
dialogs or native tool callbacks. Vision and persistent Codex thread reuse are
not enabled. Older CLI protocol versions have not been validated.

## Validation — 2026-09-17

- Provider suite: 35 files / 369 tests passed, including 15 app-server tests.
- TypeScript and ESLint for all changed TypeScript files passed.
- Rust suite: 26 passed; two installed-CLI tests are opt-in by default.
- Installed Claude version/launch smoke passed without model inference.
- Installed Codex handshake, model listing, ephemeral thread creation and stop
  passed through the actual Rust Channel/stdin transport.
- Real Codex inference produced a text delta before turn completion and stopped
  cleanly. The restricted-network run timed out; the approved network rerun
  passed in approximately seven seconds. No prompts or model output were logged.
- Native desktop window interaction, browser E2E, macOS/Linux runtime checks and
  a new static export build were not run. Routing/build configuration did not
  change. Repository-wide lint was not rerun; the earlier review's baseline
  errors remain a separate task.

Run the installed Codex smoke explicitly:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --offline smoke_codex_app_server_handshake -- --ignored
```

To opt into one small authenticated inference, set
`TME_CODEX_SMOKE_INFERENCE=1` for that command. The default smoke consumes no
inference quota. The test owns and shuts down its child process even on failure.

Follow-up: chat, cancel, model selection and reload/exit were subsequently
verified in the actual Windows desktop application. See
[Desktop QA and lint cleanup](DESKTOP_QA_AND_LINT.md) for results and remaining
limitations; it also supersedes the repository lint baseline above.
