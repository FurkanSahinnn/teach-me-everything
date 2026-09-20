//! Local agent-CLI transport.
//!
//! Spawns a user-installed agent CLI (`claude` or `codex`) as a child
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
//! commands accept only supported CLI entry points and inference profiles.
//! The configured installation and inherited environment remain trusted local
//! software; a matching filename is not proof of a binary's authenticity.
//!
//! Why sessions spawn through `std::process` + `shared_child` rather than
//! `plugin-shell`'s `Command`: the plugin's `CommandChild` owns the stdin pipe
//! and offers no way to close it short of dropping the handle you also need for
//! `kill`. `codex exec -` reads its prompt to EOF, so a stdin that never closes
//! hangs the turn forever. Version probes share the managed process transport
//! with null stdin and a fixed timeout.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use shared_child::SharedChild;
use crate::agent_process::ProcessTree;
use tauri::ipc::Channel;
use tauri::State;

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

/// One spawned agent process.
///
/// `stdin` sits behind its own lock, separate from the session registry: the
/// opening turn can be hundreds of kilobytes and a pipe write blocks once the
/// child stops draining it, so the writer must never hold the registry — or
/// `stop` could not find the session to kill. `None` once closed, either
/// because the caller asked for EOF after the opening turn or because it was
/// never captured.
struct Session {
  child: Arc<SharedChild>,
  tree: Arc<ProcessTree>,
  prompt: Option<Arc<tempfile::TempPath>>,
  stdin: Arc<Mutex<Option<ChildStdin>>>,
}

type SessionMap = Arc<Mutex<HashMap<String, Session>>>;

#[derive(Default)]
pub struct AgentCliState {
  sessions: SessionMap,
}

impl AgentCliState {
  pub fn shutdown(&self) {
    let entries: Vec<_> = self.sessions.lock().unwrap_or_else(|e| e.into_inner())
      .drain().map(|(_, entry)| entry).collect();
    for entry in entries {
      entry.tree.terminate();
      let _ = entry.child.kill();
      if let Some(prompt) = entry.prompt { let _ = std::fs::remove_file(&**prompt); }
    }
  }
}

fn validate_cli(cli: &str) -> Result<(), String> {
  if matches!(cli, "claude" | "codex") { Ok(()) }
  else { Err("Only claude and codex CLIs are supported".into()) }
}

fn validate_entry(cli: &str, path: &Path) -> Result<(), String> {
  validate_cli(cli)?;
  let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
  let allowed = match cli {
    "claude" => matches!(name.as_str(), "claude" | "claude.exe" | "cli.js" | "cli-wrapper.cjs"),
    "codex" => matches!(name.as_str(), "codex" | "codex.exe" | "codex.js"),
    _ => false,
  };
  if allowed { Ok(()) } else { Err(format!("Expected a {cli} executable or its package entry point")) }
}

fn validate_options(options: &StartOptions) -> Result<(), String> {
  validate_cli(&options.cli)?;
  if options.cwd.is_some() { return Err("Agent working directories are managed by TME".into()); }
  for key in options.env.keys() {
    if !matches!(key.to_ascii_uppercase().as_str(), "HTTP_PROXY" | "HTTPS_PROXY" | "ALL_PROXY" | "NO_PROXY"
      | "ANTHROPIC_API_KEY" | "ANTHROPIC_AUTH_TOKEN" | "OPENAI_API_KEY") {
      return Err(format!("Unsupported agent environment override: {key}"));
    }
  }
  let args = &options.args;
  if options.cli == "codex" {
    if args == &["app-server"] { return Ok(()); }
    let prefix = ["exec", "--json", "--color", "never", "--ephemeral", "--ignore-user-config",
      "--ignore-rules", "--skip-git-repo-check", "--sandbox", "read-only", "--model"];
    if args.len() == prefix.len() + 2 && args[..prefix.len()] == prefix
      && !args[prefix.len()].starts_with('-') && args.last().is_some_and(|a| a == "-") {
      return Ok(());
    }
  } else {
    let prefix = ["-p", "--output-format", "stream-json", "--input-format", "stream-json",
      "--include-partial-messages", "--verbose", "--model"];
    let suffix = ["--safe-mode", "--restricted", "--strict-mcp-config", "--disable-slash-commands",
      "--setting-sources", "", "--disallowedTools"];
    let offset = prefix.len() + 1;
    if args.len() > offset + suffix.len() && args[..prefix.len()] == prefix
      && !args[prefix.len()].starts_with('-') && args[offset..offset + suffix.len()] == suffix
      && args[offset + suffix.len()..].iter().all(|a| !a.is_empty() && a.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')) {
      return Ok(());
    }
  }
  Err("Unsupported agent invocation; use TME's inference or model discovery profile".into())
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
  /// One line of stdout, line ending stripped — exactly one NDJSON frame.
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
  /// NDJSON (or a raw prompt) written to stdin immediately after spawn.
  pub stdin: Option<String>,
  /// Close stdin right after the opening write. Required for a CLI that reads
  /// its prompt to EOF (`codex exec -`); wrong for one that holds a session
  /// open and waits for further turns (`claude --input-format stream-json`).
  pub close_stdin: Option<bool>,
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
         Point at the native executable (claude.exe / codex.exe) or at the \
         package's wrapper script (cli-wrapper.cjs)."
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
      // past them to the package's own entry point.
      let modules = npm.join("node_modules");
      match cli {
        "claude" => {
          let package = modules.join("@anthropic-ai").join("claude-code");
          out.push(package.join("bin").join("claude.exe"));
          out.push(package.join("cli.js"));
          out.push(package.join("cli-wrapper.cjs"));
        }
        "codex" => {
          // The native binary first: the package's `bin/codex.js` only spawns
          // it as a grandchild, which a kill on the wrapper would orphan.
          out.push(
            modules
              .join("@openai")
              .join("codex")
              .join("node_modules")
              .join("@openai")
              .join("codex-win32-x64")
              .join("vendor")
              .join("x86_64-pc-windows-msvc")
              .join("bin")
              .join("codex.exe"),
          );
          out.push(modules.join("@openai").join("codex").join("bin").join("codex.js"));
        }
        _ => {}
      }
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

fn stage_prompt(text: &str) -> Result<Arc<tempfile::TempPath>, String> {
  let mut file = tempfile::Builder::new().prefix("tme-agent-sys-").suffix(".txt")
    .tempfile().map_err(|e| format!("Could not stage the system prompt: {e}"))?;
  file.write_all(text.as_bytes()).map_err(|e| format!("Could not stage the system prompt: {e}"))?;
  Ok(Arc::new(file.into_temp_path()))
}

fn append_tail(tail: &mut String, text: &str) {
  tail.push_str(text);
  if tail.len() > STDERR_TAIL_CAP {
    let mut start = tail.len() - STDERR_TAIL_CAP;
    while !tail.is_char_boundary(start) { start += 1; }
    tail.drain(..start);
  }
}

fn launcher_label(launch: &Launch) -> Option<String> {
  if launch.prefix_args.is_empty() {
    None
  } else {
    Some(launch.program.clone())
  }
}

#[tauri::command]
pub async fn agent_cli_probe(
  cli: String,
  path: Option<String>,
) -> AgentCliProbe {
  tauri::async_runtime::spawn_blocking(move || probe_cli(&cli, path)).await
    .unwrap_or_else(|e| AgentCliProbe { found: false, path: None, launcher: None,
      version: None, error: Some(format!("Could not schedule agent probe: {e}")) })
}

fn probe_cli(cli: &str, path: Option<String>) -> AgentCliProbe {
  if let Err(error) = validate_cli(&cli) {
    return AgentCliProbe { found: false, path: None, launcher: None, version: None, error: Some(error) };
  }
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

  let launch = match validate_entry(&cli, &resolved).and_then(|_| resolve_launch(&resolved)) {
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

  let mut command = Command::new(&launch.program);
  command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
  let (child, tree) = match spawn_managed(&mut command) {
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
  let stdout_reader = child.take_stdout().map(|pipe| std::thread::spawn(move || read_tail(pipe)));
  let stderr_reader = child.take_stderr().map(|pipe| std::thread::spawn(move || read_tail(pipe)));
  let status = child.wait_timeout(std::time::Duration::from_secs(10));
  tree.terminate();
  let _ = child.kill();
  let _ = child.wait();
  let stdout = stdout_reader.and_then(|t| t.join().ok()).unwrap_or_default();
  let stderr_tail = stderr_reader.and_then(|t| t.join().ok()).unwrap_or_default();
  let failure = match status {
    Ok(Some(status)) if status.success() => None,
    Ok(None) => Some("Agent version probe timed out".to_string()),
    Ok(Some(_)) => Some(if stderr_tail.trim().is_empty() { "Agent version probe failed".to_string() } else { stderr_tail.trim().to_string() }),
    Err(e) => Some(format!("Could not wait for agent probe: {e}")),
  };
  if let Some(error) = failure {
    return AgentCliProbe { found: false, path: Some(resolved.display().to_string()),
      launcher: launcher_label(&launch), version: None, error: Some(error) };
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

fn read_tail(mut reader: impl Read) -> String {
  let mut tail = String::new();
  let mut bytes = [0u8; 4096];
  while let Ok(n) = reader.read(&mut bytes) {
    if n == 0 { break; }
    append_tail(&mut tail, &String::from_utf8_lossy(&bytes[..n]));
  }
  tail
}

fn spawn_managed(cmd: &mut Command) -> Result<(Arc<SharedChild>, Arc<ProcessTree>), String> {
  ProcessTree::configure(cmd);
  let mut raw = cmd.spawn().map_err(|e| format!("Could not spawn agent: {e}"))?;
  let tree = match ProcessTree::attach(&raw) {
    Ok(tree) => Arc::new(tree),
    Err(e) => {
      let _ = raw.kill();
      let _ = raw.wait();
      return Err(format!("Could not contain agent process: {e}"));
    }
  };
  let child = SharedChild::new(raw).map_err(|e| {
    tree.terminate();
    format!("Could not manage agent: {e}")
  })?;
  Ok((Arc::new(child), tree))
}

/// Async so the spawn runs off the main thread: a plain `fn` command executes
/// on it, and `CreateProcess` plus the temp-file write are tens of
/// milliseconds the UI would spend frozen on every turn.
///
/// Also a thin wrapper so a start failure is visible somewhere other than the
/// webview. The panel shows the message to the user, but during development
/// the `tauri:dev` console is where it is actually useful.
#[tauri::command]
pub async fn agent_cli_start(
  state: State<'_, AgentCliState>,
  options: StartOptions,
  on_event: Channel<AgentCliEvent>,
) -> Result<String, String> {
  let sessions = state.sessions.clone();
  validate_options(&options)?;
  let result = tauri::async_runtime::spawn_blocking(move || {
    start_session(&sessions, options, on_event)
  })
  .await
  .map_err(|e| format!("Could not schedule the agent CLI start: {e}"))?;
  if let Err(reason) = &result {
    log::warn!("agent_cli_start failed: {reason}");
  }
  result
}

/// Reads one pipe to EOF, one line per callback. Bytes rather than `lines()`
/// so an invalid UTF-8 byte in CLI chatter degrades to U+FFFD instead of
/// ending the stream early.
fn pump_lines<Rd: Read>(reader: Rd, mut on_line: impl FnMut(String)) {
  let mut buf = BufReader::new(reader);
  let mut bytes = Vec::new();
  loop {
    bytes.clear();
    match buf.read_until(b'\n', &mut bytes) {
      Ok(0) | Err(_) => break,
      Ok(_) => {
        // The CLI emits CRLF on Windows and `JSON.parse` rejects the trailing
        // carriage return, so strip both endings here.
        let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
        if !line.is_empty() {
          on_line(line);
        }
      }
    }
  }
}

fn start_session(
  sessions: &SessionMap,
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
  #[cfg(not(test))]
  validate_entry(&options.cli, &resolved)?;

  let mut registry = sessions.lock().map_err(|_| "Agent session registry is poisoned".to_string())?;
  if registry.contains_key(&session) { return Err("Agent session already exists".into()); }

  let mut args = launch.prefix_args.clone();
  args.extend(options.args.iter().cloned());

  let sys_path = match options.system_prompt.as_ref() {
    Some(text) => {
      let p = stage_prompt(text)?;
      args.push("--system-prompt-file".to_string());
      args.push(p.display().to_string());
      Some(p)
    }
    None => None,
  };
  let cleanup_sys = {
    let sys_path = sys_path.clone();
    move || {
      if let Some(p) = sys_path.as_ref() {
        let _ = std::fs::remove_file(&***p);
      }
    }
  };

  let mut cmd = Command::new(&launch.program);
  cmd
    .args(&args)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
  // Env vars are added on top of the inherited environment. No case-folding is
  // needed for PATH/Path: Rust's `Command` compares Windows env keys
  // case-insensitively, unlike Node's plain object which yields two keys.
  if !options.env.is_empty() {
    cmd.envs(options.env.iter());
  }
  if let Some(dir) = options.cwd.as_deref().filter(|d| !d.trim().is_empty()) {
    cmd.current_dir(PathBuf::from(dir));
  }
  let (child, tree) = match spawn_managed(&mut cmd) {
    Ok(pair) => pair,
    Err(e) => {
      cleanup_sys();
      return Err(format!("Could not launch {}: {e}", launch.program));
    }
  };

  let stdin: Arc<Mutex<Option<ChildStdin>>> = Arc::new(Mutex::new(child.take_stdin()));
  let stdout = child.take_stdout();
  let stderr = child.take_stderr();

  // Registered before any pipe traffic so `stop` can always find a session
  // that has a live process behind it.
  registry.insert(
      session.clone(),
      Session {
        child: child.clone(),
        tree: tree.clone(),
        prompt: sys_path.clone(),
        stdin: stdin.clone(),
      },
    );
  drop(registry);

  // Readers start BEFORE the opening write. The order matters: an anonymous
  // pipe holds only a few kilobytes (4 KiB on Windows), so a child that prints
  // a banner or its first events before it has consumed a long stdin document
  // fills its stdout while we are still blocked filling its stdin — the
  // classic two-pipe deadlock. With the readers already draining, the write
  // can only wait on the child actually reading.

  // stdout: one event per line.
  let stdout_thread = stdout.map(|pipe| {
    let ch = on_event.clone();
    std::thread::spawn(move || {
      pump_lines(pipe, |line| {
        let _ = ch.send(AgentCliEvent::Line { data: line });
      });
    })
  });

  // stderr: always drained — a full pipe (4–64 KB depending on platform)
  // blocks the child forever. Retained tail is capped.
  let stderr_tail: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
  let stderr_thread = stderr.map(|pipe| {
    let ch = on_event.clone();
    let tail = stderr_tail.clone();
    std::thread::spawn(move || {
      pump_lines(pipe, |line| {
        if let Ok(mut t) = tail.lock() {
          append_tail(&mut t, &line);
          append_tail(&mut t, "\n");
        }
        let _ = ch.send(AgentCliEvent::Stderr { data: line });
      });
    })
  });

  // The opening write on its own thread, so neither the command nor the
  // registry waits on the child draining a large prompt. A failed write means
  // the child closed its end — almost always because it died on startup, in
  // which case its stderr tail explains why on the exit path below. The
  // failure is kept as a fallback message for the rare child that closed
  // stdin and kept running; that one is killed so the turn cannot hang.
  let write_failure: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
  let close_stdin = options.close_stdin.unwrap_or(false);
  if options.stdin.is_some() || close_stdin {
    let stdin = stdin.clone();
    let child = child.clone();
    let tree = tree.clone();
    let failure = write_failure.clone();
    let payload = options.stdin;
    std::thread::spawn(move || {
      let mut guard = match stdin.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
      };
      if let Some(payload) = payload {
        let result = match guard.as_mut() {
          Some(w) => w.write_all(payload.as_bytes()).and_then(|_| w.flush()),
          None => Err(std::io::Error::other("stdin was not captured")),
        };
        if let Err(e) = result {
          log::warn!("agent CLI opening write failed: {e}");
          if let Ok(mut f) = failure.lock() {
            *f = Some(format!("Could not write the opening turn: {e}"));
          }
          tree.terminate();
          let _ = child.kill();
        }
      }
      if close_stdin {
        // Dropping the writer is the EOF the CLI is waiting for.
        *guard = None;
      }
    });
  }

  let sessions = sessions.clone();
  let wait_session = session.clone();
  std::thread::spawn(move || {
    let status = child.wait();
    tree.terminate();
    // Descendants also own the pipes; terminate them before joining readers.
    // Joining orders
    // every Line before the Exit that follows.
    if let Some(t) = stdout_thread {
      let _ = t.join();
    }
    if let Some(t) = stderr_thread {
      let _ = t.join();
    }
    if let Ok(mut map) = sessions.lock() {
      if map.get(&wait_session).is_some_and(|entry| Arc::ptr_eq(&entry.child, &child)) {
        map.remove(&wait_session);
      }
    }
    cleanup_sys();
    match status {
      Ok(status) => {
        // `success()` rather than `code() == 0`: a child killed by a signal
        // reports no code on Unix, and treating that as success would let a
        // turn end in silence with nothing to show for it.
        if !status.success() {
          let tail = stderr_tail
            .lock()
            .map(|t| t.trim().to_string())
            .unwrap_or_default();
          let fallback = write_failure.lock().ok().and_then(|f| f.clone());
          let message = if tail.is_empty() { fallback } else { Some(tail) };
          if let Some(message) = message {
            let _ = on_event.send(AgentCliEvent::Error { message });
          }
        }
        let _ = on_event.send(AgentCliEvent::Exit {
          code: status.code(),
        });
      }
      Err(e) => {
        let _ = on_event.send(AgentCliEvent::Error {
          message: format!("Could not wait for the agent CLI: {e}"),
        });
        let _ = on_event.send(AgentCliEvent::Exit { code: None });
      }
    }
  });

  Ok(session)
}

/// Async for the same reason as `start`: a pipe write blocks once the child
/// stops draining, and that must never be the main thread waiting.
#[tauri::command]
pub async fn agent_cli_write(
  state: State<'_, AgentCliState>,
  session: String,
  line: String,
) -> Result<(), String> {
  let sessions = state.sessions.clone();
  tauri::async_runtime::spawn_blocking(move || write_session(&sessions, &session, &line))
    .await
    .map_err(|e| format!("Could not schedule the agent CLI write: {e}"))?
}

fn write_session(sessions: &SessionMap, session: &str, line: &str) -> Result<(), String> {
  // Take the stdin handle out from under the registry lock before writing, so
  // a slow write cannot stall `start` / `stop` / the exit bookkeeping.
  let stdin = {
    let map = sessions
      .lock()
      .map_err(|_| "Agent session registry is poisoned".to_string())?;
    map
      .get(session)
      .map(|entry| entry.stdin.clone())
      .ok_or_else(|| format!("No running agent session {session}"))?
  };
  let mut guard = stdin
    .lock()
    .map_err(|_| "Agent session input is poisoned".to_string())?;
  let writer = guard
    .as_mut()
    .ok_or_else(|| format!("Agent session {session} has closed its input"))?;
  writer
    .write_all(line.as_bytes())
    .and_then(|_| writer.flush())
    .map_err(|e| format!("Could not write to the agent session: {e}"))
}

#[tauri::command]
pub fn agent_cli_stop(state: State<'_, AgentCliState>, session: String) -> Result<(), String> {
  stop_session(&state.sessions, &session)
}

fn stop_session(sessions: &SessionMap, session: &str) -> Result<(), String> {
  sanitize_session(session)?;
  let entry = {
    let mut map = sessions
      .lock()
      .map_err(|_| "Agent session registry is poisoned".to_string())?;
    map.remove(session)
  };
  // Stopping an already-finished session is how an aborted turn and a
  // naturally-completed one both unwind, so absence is success, not an error.
  if let Some(entry) = entry {
    entry.tree.terminate();
    let result = entry.child.kill();
    if let Some(prompt) = entry.prompt { let _ = std::fs::remove_file(&**prompt); }
    result.map_err(|e| format!("Could not stop the agent session: {e}"))?;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_file(name: &str, contents: &[u8]) -> PathBuf {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let p = std::env::temp_dir().join(format!("{}-{id}-{name}", std::process::id()));
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
  fn stop_rejects_traversal_even_without_a_session() {
    assert!(stop_session(&Arc::default(), "x/../../notes").is_err());
  }

  #[test]
  fn rejects_unrelated_programs_and_dangerous_profiles() {
    assert!(validate_cli("cmd").is_err());
    assert!(validate_entry("claude", Path::new("powershell.exe")).is_err());
    assert!(validate_entry("codex", Path::new("claude.exe")).is_err());
    let mut options = fixture_options("validation", Path::new("codex.exe"), None, false);
    options.cli = "codex".into();
    options.args = vec!["app-server".into()];
    assert!(validate_options(&options).is_ok());
    options.env.insert("NODE_OPTIONS".into(), "--require=evil.js".into());
    assert!(validate_options(&options).is_err());
    options.env.clear();
    options.args = vec!["exec".into(), "--dangerously-bypass-approvals-and-sandbox".into()];
    assert!(validate_options(&options).is_err());
  }

  #[test]
  fn stderr_is_a_bounded_utf8_tail() {
    let mut tail = "early".repeat(10000);
    append_tail(&mut tail, &"ç".repeat(10000));
    append_tail(&mut tail, "final error");
    assert!(tail.len() <= STDERR_TAIL_CAP);
    assert!(tail.ends_with("final error"));
    assert!(!tail.contains("early"));
  }

  #[test]
  fn prompt_files_are_unique_and_removed_on_drop() {
    let first = stage_prompt("one").unwrap();
    let second = stage_prompt("two").unwrap();
    assert_ne!(first.to_path_buf(), second.to_path_buf());
    let path = first.to_path_buf();
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }
    drop(first);
    assert!(!path.exists());
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

  #[test]
  fn candidate_paths_do_not_cross_wire_the_two_clis() {
    let codex = candidate_paths("codex");
    assert!(codex.iter().all(|p| p.file_stem().is_some_and(|s| s == "codex")));
    let claude = candidate_paths("claude");
    assert!(claude.iter().all(|p| p.file_stem().is_some_and(|s| s == "claude" || s == "cli" || s == "cli-wrapper")));
  }

  // ------------------------------------------------------------------------
  // Live-child tests. They drive `start_session` against a real process —
  // `node` running a fixture script — because the failures they guard against
  // (a two-pipe deadlock, a lost stdin handle) only exist with real pipes.
  // Skipped, not failed, on a machine without node.
  // ------------------------------------------------------------------------

  use std::sync::mpsc;
  use std::time::Duration;
  use tauri::ipc::InvokeResponseBody;

  const LIVE_TIMEOUT: Duration = Duration::from_secs(60);

  fn node_available() -> bool {
    std::process::Command::new("node")
      .arg("--version")
      .output()
      .map(|o| o.status.success())
      .unwrap_or(false)
  }

  /// A Channel whose messages land on an mpsc receiver as JSON strings.
  fn capture_channel() -> (Channel<AgentCliEvent>, mpsc::Receiver<String>) {
    let (tx, rx) = mpsc::channel::<String>();
    let channel = Channel::new(move |body| {
      if let InvokeResponseBody::Json(json) = body {
        let _ = tx.send(json);
      }
      Ok(())
    });
    (channel, rx)
  }

  /// Drains events until `exit`, returning (stdout lines, error messages, exit code).
  fn drain_until_exit(rx: &mpsc::Receiver<String>) -> (Vec<String>, Vec<String>, Option<i64>) {
    let mut lines = Vec::new();
    let mut errors = Vec::new();
    loop {
      let json = rx
        .recv_timeout(LIVE_TIMEOUT)
        .expect("no exit event within the timeout — the session is hung");
      let v: serde_json::Value = serde_json::from_str(&json).expect("event is JSON");
      match v["type"].as_str() {
        Some("line") => lines.push(v["data"].as_str().unwrap_or_default().to_string()),
        Some("error") => errors.push(v["message"].as_str().unwrap_or_default().to_string()),
        Some("exit") => return (lines, errors, v["code"].as_i64()),
        _ => {}
      }
    }
  }

  fn fixture_options(session: &str, script: &Path, stdin: Option<String>, close_stdin: bool) -> StartOptions {
    StartOptions {
      session: session.to_string(),
      cli: "node-fixture".to_string(),
      path: Some(script.display().to_string()),
      args: Vec::new(),
      system_prompt: None,
      env: HashMap::new(),
      cwd: None,
      stdin,
      close_stdin: Some(close_stdin),
    }
  }

  #[test]
  fn live_large_stdin_and_stdout_do_not_deadlock() {
    if !node_available() {
      eprintln!("skipping: node not installed");
      return;
    }
    // The child floods stdout SYNCHRONOUSLY before it reads a byte of stdin —
    // exactly the shape that hangs forever when the parent writes the opening
    // turn before its readers are draining. Sizes are well past any pipe
    // buffer (4 KiB on Windows, 64 KiB on Linux).
    let script = temp_file(
      "tme-test-flood.cjs",
      br#"const fs = require("fs");
fs.writeSync(1, Buffer.alloc(300 * 1024, 0x78));
fs.writeSync(1, "\n");
let n = 0;
process.stdin.on("data", (c) => { n += c.length; });
process.stdin.on("end", () => { fs.writeSync(1, `read:${n}\n`); process.exit(0); });
"#,
    );
    let payload = "y".repeat(200 * 1024);
    let sessions: SessionMap = Arc::default();
    let (channel, rx) = capture_channel();
    let key = start_session(
      &sessions,
      fixture_options("live-flood", &script, Some(payload.clone()), true),
      channel,
    )
    .expect("start_session");
    let (lines, errors, code) = drain_until_exit(&rx);
    let _ = std::fs::remove_file(&script);

    assert_eq!(code, Some(0), "errors: {errors:?}");
    assert!(errors.is_empty(), "unexpected errors: {errors:?}");
    assert_eq!(
      lines.last().map(String::as_str),
      Some(format!("read:{}", payload.len()).as_str()),
      "the child must have received the whole opening turn"
    );
    assert!(
      sessions.lock().unwrap().get(&key).is_none(),
      "the exit path must remove the session"
    );
  }

  #[test]
  fn live_multi_turn_write_reaches_a_session_that_keeps_stdin_open() {
    if !node_available() {
      eprintln!("skipping: node not installed");
      return;
    }
    // Echoes each stdin line back; `quit` ends it. The opening turn is written
    // by `start_session`, the second by `write_session` — the claude path.
    let script = temp_file(
      "tme-test-echo.cjs",
      br#"const rl = require("readline").createInterface({ input: process.stdin });
rl.on("line", (l) => { if (l === "quit") process.exit(0); process.stdout.write(`echo:${l}\n`); });
"#,
    );
    let sessions: SessionMap = Arc::default();
    let (channel, rx) = capture_channel();
    let key = start_session(
      &sessions,
      fixture_options("live-echo", &script, Some("first\n".to_string()), false),
      channel,
    )
    .expect("start_session");
    // Wait for the echo of the opening turn before writing the next one, so
    // the test proves ordering rather than racing it.
    let first = rx.recv_timeout(LIVE_TIMEOUT).expect("first echo");
    assert!(first.contains("echo:first"), "got {first}");
    write_session(&sessions, &key, "second\nquit\n").expect("write_session");
    let (lines, errors, code) = drain_until_exit(&rx);
    let _ = std::fs::remove_file(&script);

    assert_eq!(code, Some(0), "errors: {errors:?}");
    assert_eq!(lines, vec!["echo:second".to_string()]);
    assert!(
      write_session(&sessions, &key, "late\n").is_err(),
      "writing to an exited session must fail, not hang"
    );
  }

  #[test]
  fn live_stop_kills_a_waiting_child_and_cleans_the_prompt_file() {
    if !node_available() {
      eprintln!("skipping: node not installed");
      return;
    }
    // Never exits on its own — like a CLI waiting for its next turn.
    let script = temp_file("tme-test-wait.cjs", b"setInterval(() => {}, 1000);\n");
    let sessions: SessionMap = Arc::default();
    let (channel, rx) = capture_channel();
    let mut options = fixture_options("live-stop", &script, None, false);
    options.system_prompt = Some("You are a fixture.".to_string());
    let key = start_session(&sessions, options, channel).expect("start_session");
    let prompt = sessions.lock().unwrap().get(&key).unwrap().prompt.as_ref().unwrap().to_path_buf();
    assert!(prompt.is_file(), "the system prompt must be staged to a file");
    assert!(sessions.lock().unwrap().get(&key).is_some());

    stop_session(&sessions, &key).expect("stop_session");
    let (_lines, _errors, code) = drain_until_exit(&rx);
    let _ = std::fs::remove_file(&script);

    assert_ne!(code, Some(0), "a killed child must not report success");
    assert!(sessions.lock().unwrap().get(&key).is_none());
    assert!(!prompt.exists(), "the staged prompt must be deleted on exit");
    // Stopping again is the no-op the providers rely on after a natural exit.
    stop_session(&sessions, &key).expect("second stop is a no-op");
  }

  /// Verifies the installed app-server through Tauri's Channel/stdin transport.
  /// No inference unless TME_CODEX_SMOKE_INFERENCE=1 explicitly opts into it.
  #[test]
  #[ignore = "requires an installed Codex CLI"]
  fn smoke_codex_app_server_handshake() {
    struct Cleanup(AgentCliState);
    impl Drop for Cleanup { fn drop(&mut self) { self.0.shutdown(); } }
    let state = Cleanup(AgentCliState::default());
    let found = detect_cli("codex").expect("Codex not installed");
    let (channel, rx) = capture_channel();
    let mut options = fixture_options("codex-smoke", &found, Some(
      "{\"id\":1,\"method\":\"initialize\",\"params\":{\"clientInfo\":{\"name\":\"tme\",\"version\":\"1\"}}}\n".into()
    ), false);
    options.cli = "codex".into();
    options.args = vec!["app-server".into()];
    validate_options(&options).unwrap();
    let key = start_session(&state.0.sessions, options, channel).expect("start Codex");
    let response = |id: i64| -> serde_json::Value {
      let deadline = std::time::Instant::now() + Duration::from_secs(30);
      loop {
        let event: serde_json::Value = serde_json::from_str(&rx.recv_timeout(
          deadline.saturating_duration_since(std::time::Instant::now())
        ).expect("app-server response timeout")).unwrap();
        assert!(!matches!(event["type"].as_str(), Some("exit" | "error")), "app-server terminated before response");
        if event["type"] != "line" { continue; }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(event["data"].as_str().unwrap_or("")) else { continue; };
        if value["id"].as_i64() != Some(id) { continue; }
        assert!(value.get("error").is_none(), "app-server rejected request {id}: {}", value["error"]);
        return value["result"].clone();
      }
    };
    response(1);
    write_session(&state.0.sessions, &key, "{\"method\":\"initialized\"}\n{\"id\":2,\"method\":\"model/list\",\"params\":{}}\n").unwrap();
    assert!(response(2)["data"].is_array());
    write_session(&state.0.sessions, &key, "{\"id\":3,\"method\":\"thread/start\",\"params\":{\"ephemeral\":true,\"approvalPolicy\":\"never\",\"sandbox\":\"read-only\",\"baseInstructions\":\"You are a tutor.\",\"developerInstructions\":\"\"}}\n").unwrap();
    let thread = response(3)["thread"]["id"].as_str().expect("thread id").to_string();
    // Explicit opt-in: one tiny real inference, with no prompt/response logging.
    if std::env::var("TME_CODEX_SMOKE_INFERENCE").as_deref() == Ok("1") {
      let request = serde_json::json!({"id": 4, "method": "turn/start", "params": {
        "threadId": thread, "input": [{"type": "text", "text": "Reply with just TME_OK. Do not use tools.", "text_elements": []}]
      }});
      write_session(&state.0.sessions, &key, &format!("{request}\n")).unwrap();
      let deadline = std::time::Instant::now() + Duration::from_secs(60);
      let mut saw_delta = false;
      loop {
        let raw = rx.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())).expect("inference timeout");
        let event: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(!matches!(event["type"].as_str(), Some("exit" | "error")), "process terminated during inference");
        if event["type"] != "line" { continue; }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(event["data"].as_str().unwrap_or("")) else { continue; };
        assert!(value.get("error").is_none(), "turn request rejected");
        if value["method"] == "item/agentMessage/delta" { saw_delta = true; }
        if value["method"] == "turn/completed" {
          assert_eq!(value["params"]["turn"]["status"], "completed", "inference did not complete");
          assert!(saw_delta, "no text delta before turn completion");
          break;
        }
      }
    }
    stop_session(&state.0.sessions, &key).unwrap();
    drain_until_exit(&rx);
    assert!(state.0.sessions.lock().unwrap().is_empty());
  }

  #[test]
  fn live_stop_kills_wrapper_descendants_and_releases_inherited_pipes() {
    if !node_available() { return; }
    let script = temp_file("tme-tree.cjs", br#"
require('child_process').spawn(process.execPath,
  ['-e', 'console.log("grandchild-ready");setInterval(()=>{},1000)'],
  {stdio: 'inherit', windowsHide: true});
setInterval(()=>{},1000);
"#);
    let state = AgentCliState::default();
    let (channel, rx) = capture_channel();
    let key = start_session(&state.sessions, fixture_options("tree-stop", &script, None, false), channel).unwrap();
    assert!(rx.recv_timeout(LIVE_TIMEOUT).unwrap().contains("grandchild-ready"));
    state.shutdown();
    let (_, _, code) = drain_until_exit(&rx);
    assert_ne!(code, Some(0));
    assert!(!state.sessions.lock().unwrap().contains_key(&key));
    let _ = std::fs::remove_file(script);
  }
}
