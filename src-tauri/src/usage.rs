// Usage screen backend: a read-only scan of the local Claude Code and Codex
// CLI session logs. It only ever reads token counters; message text is parsed
// past (never stored, logged or returned).
//
// Layout read:
//   <claudeHome>/projects/**/*.jsonl              (Claude Code)
//   <codexHome>/sessions/**/rollout-*.jsonl[.zst] (Codex)
//
// Parsed events are cached per file (keyed by mtime + length) so a re-scan only
// re-parses files that changed. De-duplication happens at aggregation time,
// across all files, so resumed / forked sessions that copy history count once.

use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;
use walkdir::WalkDir;

// ---------------------------------------------------------------------------
// Public command surface
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageScanArgs {
  pub since_ms: i64,
  /// Local offset east of UTC in minutes; used for day bucketing only.
  pub tz_offset_minutes: i32,
  pub claude_home: Option<String>,
  pub codex_home: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
  Claude,
  Codex,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageBucket {
  pub provider: Provider,
  pub model: String,
  /// Local day, `YYYY-MM-DD`.
  pub day: String,
  pub uncached_input: u64,
  pub cached_input: u64,
  pub cache_write: u64,
  pub output: u64,
  pub events: u64,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
pub struct SessionCounts {
  pub claude: u64,
  pub codex: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RootInfo {
  pub path: String,
  pub found: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RootsInfo {
  pub claude: RootInfo,
  pub codex: RootInfo,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageScanResult {
  pub buckets: Vec<UsageBucket>,
  pub sessions: SessionCounts,
  pub malformed: u64,
  pub files_scanned: u64,
  pub roots: RootsInfo,
}

/// Managed state: parsed events per file. Cheap to clone (shared Arc).
#[derive(Clone, Default)]
pub struct UsageCache {
  inner: Arc<Mutex<HashMap<PathBuf, CacheEntry>>>,
}

struct CacheEntry {
  mtime_ms: i64,
  len: u64,
  parsed: Arc<ParsedFile>,
}

#[tauri::command]
pub async fn usage_scan(
  app: tauri::AppHandle,
  cache: tauri::State<'_, UsageCache>,
  args: UsageScanArgs,
) -> Result<UsageScanResult, String> {
  let home = app.path().home_dir().map_err(|e| e.to_string())?;
  let claude_home = resolve_root(args.claude_home.as_deref(), &home, ".claude")?;
  let codex_home = resolve_root(args.codex_home.as_deref(), &home, ".codex")?;
  let cache = cache.inner().clone();
  let (since_ms, tz) = (args.since_ms, args.tz_offset_minutes);
  tauri::async_runtime::spawn_blocking(move || {
    scan_roots(&cache, since_ms, tz, &claude_home, &codex_home)
  })
  .await
  .map_err(|e| e.to_string())
}

/// An override must be an absolute, existing directory; no override falls back
/// to `<home>/<default_dir>` (which may legitimately not exist).
fn resolve_root(
  override_path: Option<&str>,
  home: &Path,
  default_dir: &str,
) -> Result<PathBuf, String> {
  match override_path.map(str::trim).filter(|s| !s.is_empty()) {
    None => Ok(home.join(default_dir)),
    Some(s) => {
      let p = PathBuf::from(s);
      if !p.is_absolute() {
        return Err("usage home override must be an absolute path".to_string());
      }
      if !p.is_dir() {
        return Err("usage home override must be an existing directory".to_string());
      }
      Ok(p)
    }
  }
}

// ---------------------------------------------------------------------------
// Parsed event model
// ---------------------------------------------------------------------------

/// Order: uncached input, cache read, cache write, output.
type Tokens = [u64; 4];

struct Event {
  ts_ms: i64,
  provider: Provider,
  model: Arc<str>,
  /// Global de-dupe key; `None` means "cannot be a duplicate".
  key: Option<u64>,
  session: Arc<str>,
  tokens: Tokens,
}

#[derive(Default)]
struct ParsedFile {
  events: Vec<Event>,
  malformed: u64,
}

fn hash_key<T: Hash>(provider: Provider, parts: T) -> u64 {
  let mut h = DefaultHasher::new();
  provider.hash(&mut h);
  parts.hash(&mut h);
  h.finish()
}

fn parse_ts_ms(s: &str) -> Option<i64> {
  chrono::DateTime::parse_from_rfc3339(s)
    .ok()
    .map(|d| d.timestamp_millis())
}

fn contains_bytes(hay: &[u8], needle: &[u8]) -> bool {
  hay.windows(needle.len()).any(|w| w == needle)
}

/// Missing / null counts as 0; anything else must be a non-negative integer.
fn count_field(v: &Option<Value>) -> Result<u64, ()> {
  match v {
    None | Some(Value::Null) => Ok(0),
    Some(Value::Number(n)) => n.as_u64().ok_or(()),
    Some(_) => Err(()),
  }
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ClaudeLine {
  #[serde(rename = "type")]
  kind: Option<String>,
  timestamp: Option<String>,
  #[serde(rename = "sessionId")]
  session_id: Option<String>,
  #[serde(rename = "requestId")]
  request_id: Option<String>,
  message: Option<ClaudeMessage>,
}

#[derive(Deserialize)]
struct ClaudeMessage {
  id: Option<String>,
  model: Option<String>,
  usage: Option<ClaudeUsage>,
}

#[derive(Deserialize)]
struct ClaudeUsage {
  input_tokens: Option<Value>,
  cache_creation_input_tokens: Option<Value>,
  cache_read_input_tokens: Option<Value>,
  output_tokens: Option<Value>,
}

fn claude_line(line: &[u8], fallback_session: &Arc<str>, out: &mut ParsedFile) {
  match serde_json::from_slice::<ClaudeLine>(line) {
    Ok(l) => claude_record(l, fallback_session, out),
    Err(_) => match serde_json::from_slice::<Value>(line) {
      // Valid JSON of an unrelated shape: only a usage-bearing assistant
      // record that the typed pass could not read counts as malformed.
      Ok(v) => {
        if v["type"] == "assistant" && v["message"]["usage"].is_object() {
          out.malformed += 1;
        }
      }
      Err(_) => {
        if contains_bytes(line, b"\"usage\"") {
          out.malformed += 1;
        }
      }
    },
  }
}

fn claude_record(l: ClaudeLine, fallback_session: &Arc<str>, out: &mut ParsedFile) {
  if l.kind.as_deref() != Some("assistant") {
    return;
  }
  let Some(msg) = l.message else { return };
  let Some(usage) = msg.usage else { return };
  let model = msg.model.as_deref().map(str::trim).unwrap_or("");
  if model.is_empty() || model == "<synthetic>" {
    return;
  }
  let nums = (
    count_field(&usage.input_tokens),
    count_field(&usage.cache_read_input_tokens),
    count_field(&usage.cache_creation_input_tokens),
    count_field(&usage.output_tokens),
  );
  let (Ok(input), Ok(cache_read), Ok(cache_write), Ok(output)) = nums else {
    out.malformed += 1;
    return;
  };
  let Some(ts_ms) = l.timestamp.as_deref().and_then(parse_ts_ms) else {
    out.malformed += 1;
    return;
  };
  let tokens = [input, cache_read, cache_write, output];
  if tokens.iter().all(|&t| t == 0) {
    return;
  }
  let key = msg.id.as_deref().map(|id| {
    hash_key(
      Provider::Claude,
      (id, l.request_id.as_deref().unwrap_or("")),
    )
  });
  let session = match l.session_id {
    Some(s) if !s.is_empty() => Arc::from(s.as_str()),
    _ => Arc::clone(fallback_session),
  };
  out.events.push(Event {
    ts_ms,
    provider: Provider::Claude,
    model: Arc::from(model),
    key,
    session,
    tokens,
  });
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

struct CodexRaw {
  input: u64,
  cached: u64,
  cache_write: u64,
  output: u64,
  total: Option<u64>,
}

fn codex_usage(v: &Value) -> Result<CodexRaw, ()> {
  if !v.is_object() {
    return Err(());
  }
  let get = |k: &str| -> Result<u64, ()> {
    match v.get(k) {
      None | Some(Value::Null) => Ok(0),
      Some(Value::Number(n)) => n.as_u64().ok_or(()),
      Some(_) => Err(()),
    }
  };
  let input = get("input_tokens")?;
  let cached = get("cached_input_tokens")?;
  let cache_write = get("cache_write_input_tokens")?;
  let output = get("output_tokens")?;
  get("reasoning_output_tokens")?;
  let total = match v.get("total_tokens") {
    None | Some(Value::Null) => None,
    Some(_) => Some(get("total_tokens")?),
  };
  if cached.checked_add(cache_write).is_none_or(|s| s > input) {
    return Err(());
  }
  if let Some(t) = total {
    if input.checked_add(output) != Some(t) {
      return Err(());
    }
  }
  Ok(CodexRaw {
    input,
    cached,
    cache_write,
    output,
    total,
  })
}

fn codex_norm(r: &CodexRaw) -> Tokens {
  [
    r.input - r.cached - r.cache_write,
    r.cached,
    r.cache_write,
    r.output,
  ]
}

fn codex_parse<R: BufRead>(reader: R, fallback_session: &Arc<str>) -> ParsedFile {
  let mut out = ParsedFile::default();
  let mut session: Option<Arc<str>> = None;
  let mut model: Arc<str> = Arc::from("unknown");
  let mut prev: Option<Tokens> = None;
  for_each_line(reader, &mut out, |line, out| {
    let Ok(v) = serde_json::from_slice::<Value>(line) else {
      if contains_bytes(line, b"token_count") {
        out.malformed += 1;
      }
      return;
    };
    let payload = &v["payload"];
    match v["type"].as_str() {
      Some("session_meta") => {
        if session.is_none() {
          let id = payload["session_id"]
            .as_str()
            .or_else(|| payload["id"].as_str())
            .filter(|s| !s.is_empty());
          session = id.map(Arc::from);
        }
      }
      Some("turn_context") => {
        if let Some(m) = payload["model"]
          .as_str()
          .map(str::trim)
          .filter(|s| !s.is_empty())
        {
          model = Arc::from(m);
        }
      }
      Some("event_msg") if payload["type"] == "token_count" => {
        let info = &payload["info"];
        if !info.is_object() || !info["total_token_usage"].is_object() {
          return; // rate-limit-only snapshot
        }
        let Ok(total) = codex_usage(&info["total_token_usage"]) else {
          out.malformed += 1;
          return;
        };
        let cur = codex_norm(&total);
        let delta = match prev {
          None => cur,
          Some(p) if p == cur => return,
          Some(p) if (0..4).all(|i| cur[i] >= p[i]) => {
            [cur[0] - p[0], cur[1] - p[1], cur[2] - p[2], cur[3] - p[3]]
          }
          // Counter restart: the per-turn figure is the best available delta.
          Some(_) => match codex_usage(&info["last_token_usage"]) {
            Ok(last) => codex_norm(&last),
            Err(_) => cur,
          },
        };
        prev = Some(cur);
        if delta.iter().all(|&t| t == 0) {
          return;
        }
        let Some(ts_str) = v["timestamp"].as_str() else {
          out.malformed += 1;
          return;
        };
        let Some(ts_ms) = parse_ts_ms(ts_str) else {
          out.malformed += 1;
          return;
        };
        let cum_total = total.total.unwrap_or(total.input + total.output);
        out.events.push(Event {
          ts_ms,
          provider: Provider::Codex,
          model: Arc::clone(&model),
          key: Some(hash_key(
            Provider::Codex,
            (ts_str, cum_total, total.input, total.output),
          )),
          session: session
            .clone()
            .unwrap_or_else(|| Arc::clone(fallback_session)),
          tokens: delta,
        });
      }
      _ => {}
    }
  });
  out
}

// ---------------------------------------------------------------------------
// File reading
// ---------------------------------------------------------------------------

fn for_each_line<R: BufRead, F: FnMut(&[u8], &mut ParsedFile)>(
  mut reader: R,
  out: &mut ParsedFile,
  mut f: F,
) {
  let mut buf: Vec<u8> = Vec::with_capacity(64 * 1024);
  loop {
    buf.clear();
    match reader.read_until(b'\n', &mut buf) {
      Ok(0) => break,
      Ok(_) => {
        let line = buf.trim_ascii();
        if !line.is_empty() {
          f(line, out);
        }
      }
      Err(_) => {
        // Truncated / corrupt stream: keep what was read, flag it.
        out.malformed += 1;
        break;
      }
    }
  }
}

fn open_reader(path: &Path) -> Option<Box<dyn BufRead>> {
  let file = File::open(path).ok()?;
  let is_zst = path
    .extension()
    .and_then(|e| e.to_str())
    .is_some_and(|e| e.eq_ignore_ascii_case("zst"));
  if is_zst {
    // Rollouts can be written with a large zstd window.
    let dec = ruzstd::decoding::StreamingDecoder::new_with_max_window_size(
      BufReader::new(file),
      1 << 30,
    )
    .ok()?;
    Some(Box::new(BufReader::with_capacity(256 * 1024, dec)))
  } else {
    Some(Box::new(BufReader::with_capacity(256 * 1024, file)))
  }
}

fn parse_file(provider: Provider, path: &Path) -> ParsedFile {
  let stem = path
    .file_name()
    .and_then(|n| n.to_str())
    .unwrap_or("unknown")
    .split('.')
    .next()
    .unwrap_or("unknown");
  let fallback: Arc<str> = Arc::from(stem);
  let Some(reader) = open_reader(path) else {
    return ParsedFile {
      events: Vec::new(),
      malformed: 1,
    };
  };
  match provider {
    Provider::Claude => {
      let mut out = ParsedFile::default();
      for_each_line(reader, &mut out, |line, out| {
        claude_line(line, &fallback, out)
      });
      out
    }
    Provider::Codex => codex_parse(reader, &fallback),
  }
}

// ---------------------------------------------------------------------------
// Scan + aggregate
// ---------------------------------------------------------------------------

fn is_log_file(path: &Path) -> bool {
  let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
  name.ends_with(".jsonl") || name.ends_with(".jsonl.zst")
}

fn collect_files(root: &Path, since_ms: i64) -> Vec<(PathBuf, i64, u64)> {
  if !root.is_dir() {
    return Vec::new();
  }
  let mut files = Vec::new();
  for entry in WalkDir::new(root)
    .follow_links(false)
    .into_iter()
    .filter_map(Result::ok)
  {
    if !entry.file_type().is_file() || !is_log_file(entry.path()) {
      continue;
    }
    let Ok(meta) = entry.metadata() else { continue };
    let mtime_ms = meta
      .modified()
      .ok()
      .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
      .map(|d| d.as_millis() as i64)
      .unwrap_or(i64::MAX);
    if mtime_ms < since_ms {
      continue; // nothing newer than the range start can be inside
    }
    files.push((entry.into_path(), mtime_ms, meta.len()));
  }
  files.sort_by(|a, b| a.0.cmp(&b.0));
  files
}

fn local_day(ts_ms: i64, tz_offset_minutes: i32) -> String {
  let secs = ts_ms.div_euclid(1000) + i64::from(tz_offset_minutes) * 60;
  chrono::DateTime::from_timestamp(secs, 0)
    .map(|d| d.format("%Y-%m-%d").to_string())
    .unwrap_or_else(|| "1970-01-01".to_string())
}

pub fn scan_roots(
  cache: &UsageCache,
  since_ms: i64,
  tz_offset_minutes: i32,
  claude_home: &Path,
  codex_home: &Path,
) -> UsageScanResult {
  let claude_root = claude_home.join("projects");
  let codex_root = codex_home.join("sessions");
  let roots = RootsInfo {
    claude: RootInfo {
      path: claude_home.to_string_lossy().into_owned(),
      found: claude_root.is_dir(),
    },
    codex: RootInfo {
      path: codex_home.to_string_lossy().into_owned(),
      found: codex_root.is_dir(),
    },
  };

  let mut files: Vec<(Provider, PathBuf, i64, u64)> = Vec::new();
  for (provider, root) in [
    (Provider::Claude, &claude_root),
    (Provider::Codex, &codex_root),
  ] {
    for (p, m, l) in collect_files(root, since_ms) {
      files.push((provider, p, m, l));
    }
  }

  let mut seen: HashSet<u64> = HashSet::new();
  let mut sessions: HashSet<(Provider, Arc<str>)> = HashSet::new();
  let mut buckets: BTreeMap<(Provider, Arc<str>, String), UsageBucket> = BTreeMap::new();
  let mut malformed = 0u64;
  let files_scanned = files.len() as u64;

  for (provider, path, mtime_ms, len) in files {
    let cached = {
      let guard = cache.inner.lock().unwrap_or_else(|e| e.into_inner());
      guard
        .get(&path)
        .filter(|e| e.mtime_ms == mtime_ms && e.len == len)
        .map(|e| Arc::clone(&e.parsed))
    };
    let parsed = match cached {
      Some(p) => p,
      None => {
        let p = Arc::new(parse_file(provider, &path));
        let mut guard = cache.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.insert(
          path.clone(),
          CacheEntry {
            mtime_ms,
            len,
            parsed: Arc::clone(&p),
          },
        );
        p
      }
    };
    malformed += parsed.malformed;
    for ev in &parsed.events {
      if ev.ts_ms < since_ms {
        continue;
      }
      if let Some(k) = ev.key {
        if !seen.insert(k) {
          continue;
        }
      }
      sessions.insert((ev.provider, Arc::clone(&ev.session)));
      let day = local_day(ev.ts_ms, tz_offset_minutes);
      let b = buckets
        .entry((ev.provider, Arc::clone(&ev.model), day.clone()))
        .or_insert_with(|| UsageBucket {
          provider: ev.provider,
          model: ev.model.to_string(),
          day,
          uncached_input: 0,
          cached_input: 0,
          cache_write: 0,
          output: 0,
          events: 0,
        });
      b.uncached_input += ev.tokens[0];
      b.cached_input += ev.tokens[1];
      b.cache_write += ev.tokens[2];
      b.output += ev.tokens[3];
      b.events += 1;
    }
  }

  let count = |p: Provider| sessions.iter().filter(|(sp, _)| *sp == p).count() as u64;
  UsageScanResult {
    buckets: buckets.into_values().collect(),
    sessions: SessionCounts {
      claude: count(Provider::Claude),
      codex: count(Provider::Codex),
    },
    malformed,
    files_scanned,
    roots,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;
  use std::io::Write;

  const T0: &str = "2026-03-10T12:00:00.000Z";

  struct Env {
    dir: tempfile::TempDir,
  }

  impl Env {
    fn new() -> Self {
      Env {
        dir: tempfile::tempdir().unwrap(),
      }
    }
    fn claude(&self) -> PathBuf {
      self.dir.path().join("claude")
    }
    fn codex(&self) -> PathBuf {
      self.dir.path().join("codex")
    }
    fn write(&self, path: PathBuf, lines: &[String]) -> PathBuf {
      std::fs::create_dir_all(path.parent().unwrap()).unwrap();
      std::fs::write(&path, lines.join("\n") + "\n").unwrap();
      path
    }
    fn claude_file(&self, name: &str, lines: &[String]) -> PathBuf {
      self.write(self.claude().join("projects").join("p1").join(name), lines)
    }
    fn codex_file(&self, name: &str, lines: &[String]) -> PathBuf {
      self.write(self.codex().join("sessions/2026/03/10").join(name), lines)
    }
    fn scan(&self, since: i64, tz: i32) -> UsageScanResult {
      scan_roots(&UsageCache::default(), since, tz, &self.claude(), &self.codex())
    }
  }

  fn claude_msg(id: &str, req: &str, model: &str, ts: &str, usage: Value) -> String {
    json!({
      "type": "assistant", "timestamp": ts, "sessionId": "s1", "requestId": req,
      "message": { "id": id, "model": model, "usage": usage, "content": [{"type": "text", "text": "x"}] }
    })
    .to_string()
  }

  fn cu(i: u64, cw: u64, cr: u64, o: u64) -> Value {
    json!({"input_tokens": i, "cache_creation_input_tokens": cw, "cache_read_input_tokens": cr, "output_tokens": o})
  }

  fn tok(i: u64, c: u64, cw: u64, o: u64) -> Value {
    json!({"input_tokens": i, "cached_input_tokens": c, "cache_write_input_tokens": cw,
           "output_tokens": o, "reasoning_output_tokens": 0, "total_tokens": i + o})
  }

  fn token_event(ts: &str, total: Value, last: Value) -> String {
    json!({"timestamp": ts, "type": "event_msg",
           "payload": {"type": "token_count", "info": {"total_token_usage": total, "last_token_usage": last}}})
    .to_string()
  }

  fn meta(id: &str) -> String {
    json!({"timestamp": T0, "type": "session_meta", "payload": {"id": id}}).to_string()
  }

  fn ctx(model: &str) -> String {
    json!({"timestamp": T0, "type": "turn_context", "payload": {"model": model}}).to_string()
  }

  fn sum(r: &UsageScanResult) -> Tokens {
    r.buckets.iter().fold([0; 4], |a, b| {
      [
        a[0] + b.uncached_input,
        a[1] + b.cached_input,
        a[2] + b.cache_write,
        a[3] + b.output,
      ]
    })
  }

  #[test]
  fn claude_dedupes_repeated_lines_and_across_files() {
    let e = Env::new();
    let l = claude_msg("m1", "r1", "claude-x", T0, cu(10, 2, 3, 4));
    e.claude_file("a.jsonl", &[l.clone(), l.clone()]);
    e.claude_file(
      "b.jsonl",
      &[l, claude_msg("m2", "r2", "claude-x", T0, cu(1, 0, 0, 1))],
    );
    let r = e.scan(0, 0);
    // cu(i, cache_write, cache_read, output) -> [uncached, cached, cacheWrite, output]
    assert_eq!(sum(&r), [11, 3, 2, 5]);
    assert_eq!(r.buckets[0].events, 2);
    assert_eq!(r.sessions.claude, 1);
    assert_eq!(r.files_scanned, 2);
    assert_eq!(r.malformed, 0);
  }

  #[test]
  fn claude_skips_synthetic_empty_and_zero_usage() {
    let e = Env::new();
    e.claude_file(
      "a.jsonl",
      &[
        claude_msg("m1", "r1", "<synthetic>", T0, cu(5, 0, 0, 5)),
        claude_msg("m2", "r2", "", T0, cu(5, 0, 0, 5)),
        claude_msg("m3", "r3", "claude-x", T0, cu(0, 0, 0, 0)),
      ],
    );
    let r = e.scan(0, 0);
    assert!(r.buckets.is_empty());
    assert_eq!(r.malformed, 0);
  }

  #[test]
  fn codex_cumulative_deltas_restart_and_normalization() {
    let e = Env::new();
    e.codex_file(
      "rollout-1.jsonl",
      &[
        meta("sess-1"),
        ctx("gpt-x"),
        token_event("2026-03-10T12:00:01Z", tok(100, 40, 10, 20), tok(100, 40, 10, 20)),
        // unchanged -> skipped
        token_event("2026-03-10T12:00:02Z", tok(100, 40, 10, 20), tok(0, 0, 0, 0)),
        token_event("2026-03-10T12:00:03Z", tok(150, 60, 10, 30), tok(50, 20, 0, 10)),
        // restart: totals drop, last_token_usage is used
        token_event("2026-03-10T12:00:04Z", tok(30, 5, 0, 7), tok(30, 5, 0, 7)),
      ],
    );
    let r = e.scan(0, 0);
    // first: uncached 100-40-10=50, cached 40, cw 10, out 20
    // second delta: uncached (150-60-10=80)-50=30, cached 20, cw 0, out 10
    // restart: uncached 25, cached 5, cw 0, out 7
    assert_eq!(sum(&r), [105, 65, 10, 37]);
    assert_eq!(r.buckets[0].model, "gpt-x");
    assert_eq!(r.buckets[0].events, 3);
    assert_eq!(r.sessions.codex, 1);
    assert_eq!(r.malformed, 0);
  }

  #[test]
  fn codex_fork_copy_is_deduped_globally() {
    let e = Env::new();
    let shared = vec![
      meta("parent"),
      ctx("gpt-x"),
      token_event("2026-03-10T12:00:01Z", tok(100, 0, 0, 10), tok(100, 0, 0, 10)),
    ];
    e.codex_file("rollout-a.jsonl", &shared);
    let mut forked = shared.clone();
    forked.push(token_event("2026-03-10T12:00:09Z", tok(130, 0, 0, 15), tok(30, 0, 0, 5)));
    e.codex_file("rollout-b.jsonl", &forked);
    let r = e.scan(0, 0);
    assert_eq!(sum(&r), [130, 0, 0, 15]);
    assert_eq!(r.buckets[0].events, 2);
  }

  #[test]
  fn malformed_usage_is_counted_and_skipped() {
    let e = Env::new();
    e.claude_file(
      "a.jsonl",
      &[
        claude_msg("m1", "r1", "claude-x", T0, json!({"input_tokens": -1, "output_tokens": 1})),
        claude_msg("m2", "r2", "claude-x", T0, json!({"input_tokens": 1.5})),
        "{\"type\":\"assistant\",\"message\":{\"usage\":{ broken".to_string(),
        "{not json and unrelated".to_string(),
        claude_msg("m3", "r3", "claude-x", T0, cu(1, 0, 0, 1)),
      ],
    );
    e.codex_file(
      "rollout-1.jsonl",
      &[
        ctx("gpt-x"),
        // cached + cacheWrite > input
        token_event("2026-03-10T12:00:01Z", tok(10, 8, 5, 1), tok(10, 8, 5, 1)),
        // total_tokens mismatch
        token_event(
          "2026-03-10T12:00:02Z",
          json!({"input_tokens": 10, "output_tokens": 2, "total_tokens": 99}),
          json!({}),
        ),
        token_event("2026-03-10T12:00:03Z", tok(10, 0, 0, 2), tok(10, 0, 0, 2)),
      ],
    );
    let r = e.scan(0, 0);
    assert_eq!(r.malformed, 5);
    assert_eq!(sum(&r), [11, 0, 0, 3]);
  }

  #[test]
  fn days_bucket_with_timezone_offset() {
    let e = Env::new();
    e.claude_file(
      "a.jsonl",
      &[claude_msg("m1", "r1", "claude-x", "2026-03-10T23:30:00Z", cu(1, 0, 0, 1))],
    );
    assert_eq!(e.scan(0, 0).buckets[0].day, "2026-03-10");
    assert_eq!(e.scan(0, 120).buckets[0].day, "2026-03-11");
    assert_eq!(e.scan(0, -300).buckets[0].day, "2026-03-10");
    assert_eq!(local_day(-1, 0), "1969-12-31");
  }

  #[test]
  fn since_filters_events_and_old_files_by_mtime() {
    let e = Env::new();
    e.claude_file(
      "a.jsonl",
      &[
        claude_msg("m1", "r1", "claude-x", "2026-03-01T00:00:00Z", cu(1, 0, 0, 1)),
        claude_msg("m2", "r2", "claude-x", "2026-03-10T00:00:00Z", cu(2, 0, 0, 2)),
      ],
    );
    let since = parse_ts_ms("2026-03-05T00:00:00Z").unwrap();
    // The file was just written (mtime is "now", after `since`): it is read and
    // the per-event timestamp filter applies.
    let r = e.scan(since, 0);
    assert_eq!(sum(&r), [2, 0, 0, 2]);
    // A range starting after the file's mtime skips the file entirely.
    let r = e.scan(i64::MAX / 2, 0);
    assert_eq!(r.files_scanned, 0);
    assert!(r.buckets.is_empty());
  }

  #[test]
  fn zst_rollouts_are_decoded() {
    let e = Env::new();
    let lines = [
      meta("sess-z"),
      ctx("gpt-x"),
      token_event("2026-03-10T12:00:01Z", tok(20, 5, 0, 4), tok(20, 5, 0, 4)),
    ];
    let raw = (lines.join("\n") + "\n").into_bytes();
    let zst = ruzstd::encoding::compress_to_vec(
      &raw[..],
      ruzstd::encoding::CompressionLevel::Fastest,
    );
    let path = e.codex().join("sessions/2026/03/10/rollout-z.jsonl.zst");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    File::create(&path).unwrap().write_all(&zst).unwrap();
    let r = e.scan(0, 0);
    assert_eq!(sum(&r), [15, 5, 0, 4]);
    assert_eq!(r.sessions.codex, 1);
    assert_eq!(r.malformed, 0);
  }

  #[test]
  fn missing_roots_are_not_errors_and_cache_is_populated() {
    let e = Env::new();
    let r = e.scan(0, 0);
    assert!(!r.roots.claude.found && !r.roots.codex.found);
    assert!(r.buckets.is_empty());

    e.claude_file("a.jsonl", &[claude_msg("m1", "r1", "claude-x", T0, cu(1, 0, 0, 1))]);
    let cache = UsageCache::default();
    let r1 = scan_roots(&cache, 0, 0, &e.claude(), &e.codex());
    assert!(r1.roots.claude.found);
    assert_eq!(cache.inner.lock().unwrap().len(), 1);
    let r2 = scan_roots(&cache, 0, 0, &e.claude(), &e.codex());
    assert_eq!(r1, r2);
    assert_eq!(cache.inner.lock().unwrap().len(), 1);
  }

  #[test]
  fn resolve_root_validates_overrides() {
    let home = PathBuf::from("/h");
    assert_eq!(resolve_root(None, &home, ".claude").unwrap(), home.join(".claude"));
    assert!(resolve_root(Some("relative/dir"), &home, ".claude").is_err());
    let d = tempfile::tempdir().unwrap();
    assert!(resolve_root(Some(d.path().join("nope").to_str().unwrap()), &home, ".x").is_err());
    assert_eq!(
      resolve_root(Some(d.path().to_str().unwrap()), &home, ".x").unwrap(),
      d.path().to_path_buf()
    );
  }

  #[test]
  #[ignore = "scans the real home directory; run with --ignored --nocapture"]
  fn smoke_scan_real_home() {
    let home = std::env::var_os("USERPROFILE")
      .or_else(|| std::env::var_os("HOME"))
      .map(PathBuf::from)
      .expect("home");
    let days: i64 = std::env::var("USAGE_SMOKE_DAYS").ok().and_then(|v| v.parse().ok()).unwrap_or(7);
    let since = chrono::Utc::now().timestamp_millis() - days * 86_400_000;
    let cache = UsageCache::default();
    let t = std::time::Instant::now();
    let r = scan_roots(&cache, since, 0, &home.join(".claude"), &home.join(".codex"));
    let first = t.elapsed();
    let t = std::time::Instant::now();
    let r2 = scan_roots(&cache, since, 0, &home.join(".claude"), &home.join(".codex"));
    let second = t.elapsed();
    assert_eq!(r, r2);
    let mut models: BTreeMap<(Provider, String), Tokens> = BTreeMap::new();
    for b in &r.buckets {
      let m = models.entry((b.provider, b.model.clone())).or_insert([0; 4]);
      m[0] += b.uncached_input;
      m[1] += b.cached_input;
      m[2] += b.cache_write;
      m[3] += b.output;
    }
    // Optional: write the aggregated result (counts only, no log content) for UI previews.
    if let Some(path) = std::env::var_os("USAGE_SMOKE_DUMP") {
      std::fs::write(path, serde_json::to_string(&r).expect("serialize")).expect("write dump");
    }
    println!("totals [uncached, cached, cacheWrite, output] = {:?}", sum(&r));
    for ((p, m), t) in &models {
      println!("  {:?} {} {:?}", p, m, t);
    }
    println!(
      "buckets={} sessions=claude:{} codex:{} malformed={} files={} found claude={} codex={}",
      r.buckets.len(),
      r.sessions.claude,
      r.sessions.codex,
      r.malformed,
      r.files_scanned,
      r.roots.claude.found,
      r.roots.codex.found
    );
    println!("first scan {:?}, cached re-scan {:?}", first, second);
  }
}
