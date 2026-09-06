//! Local agent-CLI transport.
//!
//! Spawns a user-installed agent CLI (`claude` today, `codex` next) as a child
//! process and streams its NDJSON stdout to the webview over a
//! `tauri::ipc::Channel`.
//!
//! Why this lives in Rust rather than the webview: the Tauri build is a static
//! export with no Node runtime, so `@anthropic-ai/claude-agent-sdk` — which the
//! web dev-server route uses — cannot run here. The CLI's `stream-json` wire
//! format is pure protocol, so we speak it directly.
//!
//! Why a dedicated command instead of `shell:allow-execute`: a permissive shell
//! scope would hand the webview a general "run any binary" primitive. These
//! commands only ever launch *the configured agent*, and the resolution rules in
//! `resolve_launch` are the boundary that keeps it that way.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Files that are scripts for a JS runtime rather than native binaries. The
/// Agent SDK's own check is extension-only and omits `.cjs`, which is exactly
/// how npm's `cli-wrapper.cjs` ends up being spawned as if it were an
/// executable; we check the shebang too (see `looks_like_node_script`).
const JS_EXTENSIONS: [&str; 5] = ["js", "mjs", "cjs", "jsx", "ts"];

/// Windows shims we refuse outright. Rust — like Node since CVE-2024-27980 —
/// will not spawn these without a shell, and routing them through `cmd.exe /c`
/// would re-open an argument-injection surface for a path the user typed.
const REFUSED_EXTENSIONS: [&str; 3] = ["cmd", "bat", "ps1"];

/// Cap on retained stderr. The child would deadlock on a full stderr pipe if we
/// stopped reading, so we always drain it; this only bounds what we keep.
const STDERR_TAIL_CAP: usize = 8192;

#[derive(Default)]
pub struct AgentCliState {
  children: Arc<Mutex<HashMap<String, CommandChild>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliProbe {
  pub found: bool,
  pub path: Option<String>,
  /// Set to "node" when the resolved target is a JS wrapper that needs a
  /// runtime in front of it. Surfaced so Settings can explain what it found.
  pub launcher: Option<String>,
  pub version: Option<String>,
  /// Reason the probe failed, for display. Never an error return: a missing
  /// CLI is an expected state, not a fault (mirrors `sysinfo_probe`).
  pub error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AgentCliEvent {
  /// One line of stdout. `plugin-shell` reads in line mode (`raw_out` defaults
  /// to false), so each event is exactly one NDJSON frame — no reassembly here.
  Line { data: String },
  Stderr { data: String },
  Exit { code: Option<i32> },
  Error { message: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
  /// Caller-generated key used to address this process in `write` / `stop`.
  pub session: String,
  /// Which CLI to auto-detect when `path` is absent.
  pub cli: String,
  pub path: Option<String>,
  pub args: Vec<String>,
  /// Written to a temp file and passed as `--system-prompt-file`. Passing it as
  /// an argv value would break on long prompts: Windows caps a command line at
  /// ~32k characters and a TME article window is far larger than that.
  pub system_prompt: Option<String>,
  pub env: HashMap<String, String>,
  pub cwd: Option<String>,
  /// NDJSON written to stdin immediately after spawn — the opening turn.
  pub stdin: Option<String>,
}

#[derive(Debug)]
struct Launch {
  program: String,
  prefix_args: Vec<String>,
}

fn read_shebang(path: &Path) -> Option<String> {
  let mut file = std::fs::File::open(path).ok()?;
  let mut buf = [0u8; 200];
  let n = file.read(&mut buf).ok()?;
  let head = String::from_utf8_lossy(&buf[..n]);
  if !head.starts_with("#!") {
    return None;
  }
  head.lines().next().map(|l| l.to_string())
}

fn looks_like_node_script(path: &Path) -> bool {
  if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
    if JS_EXTENSIONS.iter().any(|k| k.eq_ignore_ascii_case(ext)) {
      return true;
    }
  }
  read_shebang(path).is_some_and(|line| line.contains("node"))
}

/// Decide how to launch `path`, or explain why we will not.
fn resolve_launch(path: &Path) -> Result<Launch, String> {
  let display = path.display().to_string();
  if !path.is_file() {
    return Err(format!("Agent CLI not found at {display}"));
  }
  if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
    if REFUSED_EXTENSIONS.iter().any(|k| k.eq_ignore_ascii_case(ext)) {
      return Err(format!(
        "{display} is a shell wrapper and cannot be launched directly. \
         Point at the native executable (claude.exe) or at the package's \
         wrapper script (cli-wrapper.cjs)."
      ));
    }
  }
  if looks_like_node_script(path) {
    return Ok(Launch {
      program: "node".to_string(),
      prefix_args: vec![display],
    });
  }
  // npm's extension-less shim is a POSIX `sh` script. Windows has no `sh` to
  // run it with, and the resulting ENOENT is opaque — name the cause instead.
  if cfg!(windows) {
    if let Some(line) = read_shebang(path) {
      return Err(format!(
        "{display} is a POSIX shell script ({}) and cannot run on Windows. \
         Use the .exe, or the package's .cjs wrapper.",
        line.trim()
      ));
    }
  }
  Ok(Launch {
    program: display,
    prefix_args: Vec::new(),
  })
}

fn home_dir() -> Option<PathBuf> {
  std::env::var_os("USERPROFILE")
    .or_else(|| std::env::var_os("HOME"))
    .map(PathBuf::from)
}

/// Well-known install locations, most specific first, then a PATH sweep.
///
/// The PATH sweep is a fallback rather than the primary source because a GUI
/// process does not inherit the login shell's PATH — on macOS a bundled app
/// sees little more than `/usr/bin:/bin`, so a Homebrew or nvm install is
/// invisible to it.
fn candidate_paths(cli: &str) -> Vec<PathBuf> {
  let mut out: Vec<PathBuf> = Vec::new();
  let exe = if cfg!(windows) {
    format!("{cli}.exe")
  } else {
    cli.to_string()
  };

  if let Some(home) = home_dir() {
    out.push(home.join(".local").join("bin").join(&exe));
    if cfg!(windows) {
      out.push(
        home
          .join("AppData")
          .join("Local")
          .join("Programs")
          .join(cli)
          .join(&exe),
      );
    } else {
      out.push(home.join(".bun").join("bin").join(&exe));
      out.push(home.join(".volta").join("bin").join(&exe));
    }
  }

  if cfg!(windows) {
    if let Some(appdata) = std::env::var_os("APPDATA") {
      let npm = PathBuf::from(appdata).join("npm");
      out.push(npm.join(&exe));
      // npm on Windows ships `.cmd` / `.ps1` / POSIX shims we refuse, so reach
      // past them to the package's own entry script.
      out.push(
        npm
          .join("node_modules")
          .join("@anthropic-ai")
          .join("claude-code")
          .join("cli.js"),
      );
    }
  } else {
    out.push(PathBuf::from("/opt/homebrew/bin").join(&exe));
    out.push(PathBuf::from("/usr/local/bin").join(&exe));
  }

  if let Some(paths) = std::env::var_os("PATH") {
    for dir in std::env::split_paths(&paths) {
      out.push(dir.join(&exe));
    }
  }

  out
}

fn detect_cli(cli: &str) -> Option<PathBuf> {
  candidate_paths(cli).into_iter().find(|p| p.is_file())
}

/// Session keys address a temp file, so keep them to characters that cannot
/// escape a directory.
fn sanitize_session(session: &str) -> Result<String, String> {
  if session.is_empty() || session.len() > 64 {
    return Err("Invalid session key".to_string());
  }
  if !session
    .chars()
    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
  {
    return Err("Invalid session key".to_string());
  }
  Ok(session.to_string())
}

fn system_prompt_path(session: &str) -> PathBuf {
  std::env::temp_dir().join(format!("tme-agent-sys-{session}.txt"))
}

fn launcher_label(launch: &Launch) -> Option<String> {
  if launch.prefix_args.is_empty() {
    None
  } else {
    Some(launch.program.clone())
  }
}

#[tauri::command]
pub async fn agent_cli_probe<R: Runtime>(
  app: AppHandle<R>,
  cli: String,
  path: Option<String>,
) -> AgentCliProbe {
  let resolved = match path.as_deref().filter(|p| !p.trim().is_empty()) {
    Some(p) => PathBuf::from(p),
    None => match detect_cli(&cli) {
      Some(p) => p,
      None => {
        return AgentCliProbe {
          found: false,
          path: None,
          launcher: None,
          version: None,
          error: Some(format!("{cli} was not found in any known location")),
        }
      }
    },
  };

  let launch = match resolve_launch(&resolved) {
    Ok(l) => l,
    Err(e) => {
      return AgentCliProbe {
        found: false,
        path: Some(resolved.display().to_string()),
        launcher: None,
        version: None,
        error: Some(e),
      }
    }
  };

  let mut args = launch.prefix_args.clone();
  args.push("--version".to_string());

  let spawned = app.shell().command(&launch.program).args(args).spawn();
  let (mut rx, child) = match spawned {
    Ok(pair) => pair,
    Err(e) => {
      return AgentCliProbe {
        found: false,
        path: Some(resolved.display().to_string()),
        launcher: launcher_label(&launch),
        version: None,
        error: Some(format!("Could not launch {}: {e}", launch.program)),
      }
    }
  };
  // `--version` reads nothing; closing stdin keeps a CLI that *would* wait for
  // input from hanging the probe.
  drop(child);

  let mut stdout = String::new();
  let mut stderr_tail = String::new();
  while let Some(event) = rx.recv().await {
    match event {
      CommandEvent::Stdout(bytes) => {
        stdout.push_str(&String::from_utf8_lossy(&bytes));
      }
      CommandEvent::Stderr(bytes) => {
        if stderr_tail.len() < STDERR_TAIL_CAP {
          stderr_tail.push_str(&String::from_utf8_lossy(&bytes));
        }
      }
      CommandEvent::Error(err) => {
        return AgentCliProbe {
          found: false,
          path: Some(resolved.display().to_string()),
          launcher: launcher_label(&launch),
          version: None,
          error: Some(err),
        }
      }
      CommandEvent::Terminated(_) => break,
      _ => {}
    }
  }

  let version = stdout.trim().lines().next().map(|l| l.trim().to_string());
  match version.filter(|v| !v.is_empty()) {
    Some(v) => AgentCliProbe {
      found: true,
      path: Some(resolved.display().to_string()),
      launcher: launcher_label(&launch),
      version: Some(v),
      error: None,
    },
    None => AgentCliProbe {
      found: false,
      path: Some(resolved.display().to_string()),
      launcher: launcher_label(&launch),
      version: None,
      error: Some(if stderr_tail.trim().is_empty() {
        "The CLI reported no version".to_string()
      } else {
        stderr_tail.trim().to_string()
      }),
    },
  }
}

/// Thin wrapper so a start failure is visible somewhere other than the webview.
/// The panel shows the message to the user, but during development the
/// `tauri:dev` console is where it is actually useful.
#[tauri::command]
pub async fn agent_cli_start<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, AgentCliState>,
  options: StartOptions,
  on_event: Channel<AgentCliEvent>,
) -> Result<String, String> {
  let result = start_session(app, state, options, on_event).await;
  if let Err(reason) = &result {
    log::warn!("agent_cli_start failed: {reason}");
  }
  result
}

async fn start_session<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, AgentCliState>,
  options: StartOptions,
  on_event: Channel<AgentCliEvent>,
) -> Result<String, String> {
  let session = sanitize_session(&options.session)?;

  let resolved = match options.path.as_deref().filter(|p| !p.trim().is_empty()) {
    Some(p) => PathBuf::from(p),
    None => detect_cli(&options.cli)
      .ok_or_else(|| format!("{} was not found in any known location", options.cli))?,
  };
  let launch = resolve_launch(&resolved)?;

  let mut args = launch.prefix_args.clone();
  args.extend(options.args.iter().cloned());

  let sys_path = match options.system_prompt.as_ref() {
    Some(text) => {
      let p = system_prompt_path(&session);
      std::fs::write(&p, text).map_err(|e| format!("Could not stage the system prompt: {e}"))?;
      args.push("--system-prompt-file".to_string());
      args.push(p.display().to_string());
      Some(p)
    }
    None => None,
  };

  // Env vars are added on top of the inherited environment. No case-folding is
  // needed for PATH/Path: Rust's `Command` compares Windows env keys
  // case-insensitively, unlike Node's plain object which yields two keys.
  let mut cmd = app.shell().command(&launch.program).args(args);
  if !options.env.is_empty() {
    cmd = cmd.envs(options.env.clone());
  }
  if let Some(dir) = options.cwd.as_deref().filter(|d| !d.trim().is_empty()) {
    cmd = cmd.current_dir(PathBuf::from(dir));
  }

  let (mut rx, mut child) = cmd.spawn().map_err(|e| {
    if let Some(p) = sys_path.as_ref() {
      let _ = std::fs::remove_file(p);
    }
    format!("Could not launch {}: {e}", launch.program)
  })?;

  if let Some(payload) = options.stdin.as_ref() {
    if let Err(e) = child.write(payload.as_bytes()) {
      let _ = child.kill();
      if let Some(p) = sys_path.as_ref() {
        let _ = std::fs::remove_file(p);
      }
      return Err(format!("Could not write the opening turn: {e}"));
    }
  }

  let children = state.children.clone();
  children
    .lock()
    .map_err(|_| "Agent session registry is poisoned".to_string())?
    .insert(session.clone(), child);

  let pump_session = session.clone();
  tauri::async_runtime::spawn(async move {
    let mut stderr_tail = String::new();
    while let Some(event) = rx.recv().await {
      match event {
        CommandEvent::Stdout(bytes) => {
          // Trim the line ending before it reaches the JSON parser: the CLI
          // emits CRLF on Windows and `serde_json` / `JSON.parse` both reject
          // the trailing carriage return.
          let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
          if line.is_empty() {
            continue;
          }
          let _ = on_event.send(AgentCliEvent::Line { data: line });
        }
        CommandEvent::Stderr(bytes) => {
          // Draining is mandatory — a full stderr pipe (4–64 KB depending on
          // platform) blocks the child forever. Retaining is capped.
          let chunk = String::from_utf8_lossy(&bytes).to_string();
          if stderr_tail.len() < STDERR_TAIL_CAP {
            stderr_tail.push_str(&chunk);
          }
          let _ = on_event.send(AgentCliEvent::Stderr { data: chunk });
        }
        CommandEvent::Error(err) => {
          let _ = on_event.send(AgentCliEvent::Error { message: err });
        }
        CommandEvent::Terminated(status) => {
          if let Ok(mut map) = children.lock() {
            map.remove(&pump_session);
          }
          if let Some(p) = sys_path.as_ref() {
            let _ = std::fs::remove_file(p);
          }
          let code = status.code;
          if code.unwrap_or(0) != 0 && !stderr_tail.trim().is_empty() {
            let _ = on_event.send(AgentCliEvent::Error {
              message: stderr_tail.trim().to_string(),
            });
          }
          let _ = on_event.send(AgentCliEvent::Exit { code });
          break;
        }
        _ => {}
      }
    }
  });

  Ok(session)
}

#[tauri::command]
pub fn agent_cli_write(
  state: State<'_, AgentCliState>,
  session: String,
  line: String,
) -> Result<(), String> {
  let mut map = state
    .children
    .lock()
    .map_err(|_| "Agent session registry is poisoned".to_string())?;
  let child = map
    .get_mut(&session)
    .ok_or_else(|| format!("No running agent session {session}"))?;
  child
    .write(line.as_bytes())
    .map_err(|e| format!("Could not write to the agent session: {e}"))
}

#[tauri::command]
pub fn agent_cli_stop(state: State<'_, AgentCliState>, session: String) -> Result<(), String> {
  let child = {
    let mut map = state
      .children
      .lock()
      .map_err(|_| "Agent session registry is poisoned".to_string())?;
    map.remove(&session)
  };
  // Stopping an already-finished session is how an aborted turn and a
  // naturally-completed one both unwind, so absence is success, not an error.
  if let Some(child) = child {
    child
      .kill()
      .map_err(|e| format!("Could not stop the agent session: {e}"))?;
  }
  let _ = std::fs::remove_file(system_prompt_path(&session));
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Write as _;

  fn temp_file(name: &str, contents: &[u8]) -> PathBuf {
    let p = std::env::temp_dir().join(name);
    let mut f = std::fs::File::create(&p).expect("create temp file");
    f.write_all(contents).expect("write temp file");
    p
  }

  #[test]
  fn sanitize_session_accepts_plain_keys() {
    assert!(sanitize_session("abc-123_XY").is_ok());
  }

  #[test]
  fn sanitize_session_rejects_traversal() {
    // The key names a temp file, so a separator would let it escape.
    assert!(sanitize_session("../../etc/passwd").is_err());
    assert!(sanitize_session("a/b").is_err());
    assert!(sanitize_session("").is_err());
  }

  #[test]
  fn resolve_launch_refuses_cmd_shims() {
    let p = temp_file("tme-test-shim.cmd", b"@echo off\n");
    let err = resolve_launch(&p).expect_err("cmd shim must be refused");
    assert!(err.contains("shell wrapper"), "unexpected message: {err}");
    let _ = std::fs::remove_file(p);
  }

  #[test]
  fn resolve_launch_runs_js_wrappers_under_node() {
    let p = temp_file("tme-test-wrapper.cjs", b"console.log('hi')\n");
    let launch = resolve_launch(&p).expect("cjs wrapper must resolve");
    assert_eq!(launch.program, "node");
    assert_eq!(launch.prefix_args.len(), 1);
    let _ = std::fs::remove_file(p);
  }

  #[test]
  fn resolve_launch_detects_node_shebang_without_extension() {
    let p = temp_file("tme-test-shebang", b"#!/usr/bin/env node\nconsole.log(1)\n");
    let launch = resolve_launch(&p).expect("shebang script must resolve");
    assert_eq!(launch.program, "node");
    let _ = std::fs::remove_file(p);
  }

  #[test]
  fn resolve_launch_reports_missing_file() {
    let p = std::env::temp_dir().join("tme-test-does-not-exist-xyz");
    let err = resolve_launch(&p).expect_err("missing file must be refused");
    assert!(err.contains("not found"), "unexpected message: {err}");
  }

  /// Opt-in smoke test: resolves the CLI exactly as the command does, then runs
  /// it through std's spawner — which is what `plugin-shell` wraps. Ignored by
  /// default because it needs the CLI actually installed; run with
  /// `cargo test -- --ignored --nocapture` on a machine that has it.
  #[test]
  #[ignore]
  fn smoke_resolve_and_spawn_claude() {
    let found = detect_cli("claude").expect("claude not found in any candidate");
    println!("resolved  : {}", found.display());
    let launch = resolve_launch(&found).expect("resolve_launch refused it");
    println!("program   : {}", launch.program);
    println!("prefixArgs: {:?}", launch.prefix_args);
    let mut args = launch.prefix_args.clone();
    args.push("--version".to_string());
    let out = std::process::Command::new(&launch.program)
      .args(&args)
      .output()
      .expect("spawn failed");
    println!("status    : {:?}", out.status.code());
    println!("stdout    : {}", String::from_utf8_lossy(&out.stdout).trim());
    println!("stderr    : {}", String::from_utf8_lossy(&out.stderr).trim());
    assert!(out.status.success());
  }

  #[test]
  fn candidate_paths_are_non_empty_and_named_for_the_cli() {
    let paths = candidate_paths("claude");
    assert!(!paths.is_empty());
    assert!(paths
      .iter()
      .any(|p| p.to_string_lossy().to_lowercase().contains("claude")));
  }
}
