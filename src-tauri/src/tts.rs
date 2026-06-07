// Phase 11.A — Tauri-side TTS commands.
//
// Provides five commands the JS layer invokes via the standard Tauri
// `invoke` bridge:
//
//   tts_piper_check_readiness(voice_id)
//       → { state: "ready" | "missing-binary" | "missing-model",
//           voiceId, sizeBytes? }
//   tts_piper_synthesize(text, voice_id) → Vec<u8>  (WAV bytes)
//   tts_list_installed_voices() → Vec<InstalledVoice>
//   tts_install_voice(provider, voice_id) → InstalledVoice
//   tts_delete_voice(provider, voice_id) → ()
//
// The Piper sidecar lookup is wrapped in a Result so a build that ships
// without the per-platform binary (e.g. CI smoke build, dev install
// before the user runs `scripts/fetch-piper.sh`) gracefully reports
// `missing-binary` rather than panicking. The lazy install path streams
// the model ONNX + JSON from Hugging Face into
// `appDataDir/tts-models/<provider>/<voice-id>/` atomically (write to
// `.tmp`, rename on success) so a half-finished download never leaves a
// corrupt model on disk.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tokio::fs;
use tokio::io::AsyncWriteExt;

const HUGGINGFACE_BASE: &str =
  "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const MIN_PIPER_ONNX_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessResponse {
  pub state: String,
  pub voice_id: String,
  pub size_bytes: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledVoice {
  pub provider: String,
  pub voice_id: String,
  pub size_bytes: u64,
  pub installed_at: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
  pub voice_id: String,
  pub downloaded_bytes: u64,
  pub total_bytes: u64,
}

fn tts_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
  let base = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("appDataDir resolve failed: {e}"))?;
  Ok(base.join("tts-models"))
}

/// Rust target triple for the running host. Mirrors the convention used by
/// `scripts/fetch-piper.mjs` so the per-platform Piper folder name lines up.
fn current_target_triple() -> Result<&'static str, String> {
  if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
    Ok("x86_64-pc-windows-msvc")
  } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
    Ok("aarch64-apple-darwin")
  } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
    Ok("x86_64-apple-darwin")
  } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
    Ok("x86_64-unknown-linux-gnu")
  } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
    Ok("aarch64-unknown-linux-gnu")
  } else {
    Err(format!(
      "unsupported platform: os={} arch={}",
      std::env::consts::OS,
      std::env::consts::ARCH
    ))
  }
}

/// Resolve the Piper executable inside its per-platform folder. Tauri's
/// `BaseDirectory::Resource` handles dev/prod transparently:
///   • dev   → `<crate>/src-tauri/binaries/piper-<triple>/piper[.exe]`
///   • prod  → `<install>/resources/binaries/piper-<triple>/piper[.exe]`
/// The whole folder ships together so the binary's adjacent DLLs
/// (`onnxruntime.dll`, `espeak-ng.dll`, …) and `espeak-ng-data/` dictionary
/// are found via the OS's default loader path.
fn piper_binary_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
  let triple = current_target_triple()?;
  let exe_name = if cfg!(target_os = "windows") {
    "piper.exe"
  } else {
    "piper"
  };
  app
    .path()
    .resolve(
      format!("binaries/piper-{triple}/{exe_name}"),
      BaseDirectory::Resource,
    )
    .map_err(|e| format!("piper resource path resolve failed: {e}"))
}

fn voice_dir<R: Runtime>(
  app: &AppHandle<R>,
  provider: &str,
  voice_id: &str,
) -> Result<PathBuf, String> {
  // Defend against `..` smuggle — voice ids are restricted to alnum +
  // underscore + hyphen + dot. Reject anything else.
  if !voice_id
    .chars()
    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
  {
    return Err(format!("invalid voice id: {voice_id}"));
  }
  if !provider
    .chars()
    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
  {
    return Err(format!("invalid provider id: {provider}"));
  }
  Ok(tts_root(app)?.join(provider).join(voice_id))
}

fn piper_voice_paths<R: Runtime>(
  app: &AppHandle<R>,
  voice_id: &str,
) -> Result<(PathBuf, PathBuf), String> {
  let dir = voice_dir(app, "piper", voice_id)?;
  let onnx = dir.join(format!("{voice_id}.onnx"));
  let json = dir.join(format!("{voice_id}.onnx.json"));
  Ok((onnx, json))
}

#[tauri::command]
pub async fn tts_piper_check_readiness<R: Runtime>(
  app: AppHandle<R>,
  voice_id: String,
) -> Result<ReadinessResponse, String> {
  let root = tts_root(&app)?;
  cleanup_stale_downloads(&root).await;

  // Engine presence check — resolve the resource path and stat it. No
  // spawn happens here; SmartScreen / Gatekeeper review only triggers
  // when we actually exec the binary in `tts_piper_synthesize`.
  let piper_path = piper_binary_path(&app)?;
  if !piper_path.exists() {
    return Ok(ReadinessResponse {
      state: "missing-binary".into(),
      voice_id,
      size_bytes: None,
    });
  }

  let (onnx, json) = piper_voice_paths(&app, &voice_id)?;
  if validate_piper_voice_files(&onnx, &json).await.is_err() {
    return Ok(ReadinessResponse {
      state: "missing-model".into(),
      voice_id,
      size_bytes: None,
    });
  }
  Ok(ReadinessResponse {
    state: "ready".into(),
    voice_id,
    size_bytes: None,
  })
}

#[tauri::command]
pub async fn tts_piper_synthesize<R: Runtime>(
  app: AppHandle<R>,
  text: String,
  voice_id: String,
) -> Result<Vec<u8>, String> {
  if text.trim().is_empty() {
    return Err("text is empty".into());
  }
  let (onnx, json) = piper_voice_paths(&app, &voice_id)?;
  validate_piper_voice_files(&onnx, &json)
    .await
    .map_err(|e| format!("voice model not ready: {voice_id}: {e}"))?;
  let onnx_str = onnx
    .to_str()
    .ok_or_else(|| "voice path is not valid UTF-8".to_string())?;

  let piper_path = piper_binary_path(&app)?;
  if !piper_path.exists() {
    return Err(format!(
      "piper engine not bundled at {}",
      piper_path.display()
    ));
  }
  let piper_dir = piper_path
    .parent()
    .ok_or_else(|| "piper binary has no parent directory".to_string())?;
  let piper_str = piper_path
    .to_str()
    .ok_or_else(|| "piper path is not valid UTF-8".to_string())?;

  // Spawn the binary from inside its own folder so the OS dynamic loader
  // resolves the adjacent DLLs/dylibs/sos (`onnxruntime`, `espeak-ng`,
  // `piper_phonemize`, …) by the executable's directory rule before
  // falling back to system PATH. We also pass `--espeak_data` explicitly
  // so non-English voices (e.g. `tr_TR-dfki-medium`) reliably find the
  // phonemizer dictionary instead of relying on Piper's argv0-relative
  // auto-detect, which is fragile when spawned via a sidecar bridge.
  //
  // `--output_raw` makes Piper stream raw 16-bit PCM to stdout; we wrap
  // the bytes into a minimal WAV header below. Streaming WAV directly
  // via `--output_file` would require a temp file round-trip which is
  // wasteful at podcast-segment granularity.
  let espeak_data = piper_dir.join("espeak-ng-data");
  let espeak_str = espeak_data
    .to_str()
    .ok_or_else(|| "espeak-ng-data path is not valid UTF-8".to_string())?;

  let shell = app.shell();
  let (mut rx, mut child) = shell
    .command(piper_str)
    .current_dir(piper_dir)
    .args([
      "--model",
      onnx_str,
      "--output_raw",
      "--espeak_data",
      espeak_str,
      "--quiet",
    ])
    .spawn()
    .map_err(|e| format!("piper spawn failed: {e}"))?;

  // Feed text via stdin then close it so Piper finalises and exits.
  child
    .write(format!("{text}\n").as_bytes())
    .map_err(|e| format!("piper stdin write failed: {e}"))?;
  drop(child);

  let mut pcm: Vec<u8> = Vec::with_capacity(text.len() * 200);
  // Keep the last few stderr lines so a silent failure (exit 0 but no
  // stdout) can surface Piper's complaint instead of just "empty WAV".
  let mut stderr_tail: Vec<u8> = Vec::new();
  while let Some(event) = rx.recv().await {
    match event {
      CommandEvent::Stdout(bytes) => pcm.extend_from_slice(&bytes),
      CommandEvent::Stderr(bytes) => {
        // Cap at 4 KB so a verbose run doesn't balloon the buffer.
        if stderr_tail.len() < 4096 {
          stderr_tail.extend_from_slice(&bytes);
        }
      }
      CommandEvent::Error(err) => {
        return Err(format!("piper runtime error: {err}"));
      }
      CommandEvent::Terminated(status) => {
        if let Some(code) = status.code {
          if code != 0 {
            let tail = String::from_utf8_lossy(&stderr_tail);
            return Err(format!(
              "piper exited with code {code}: {}",
              tail.trim()
            ));
          }
        }
        break;
      }
      _ => {}
    }
  }

  if pcm.is_empty() {
    let tail = String::from_utf8_lossy(&stderr_tail);
    return Err(format!(
      "piper produced no audio output. Stderr: {}",
      tail.trim()
    ));
  }

  // Piper voices are 22050 Hz mono 16-bit PCM by default. We could read
  // sample_rate from the .onnx.json sidecar config for stricter fidelity;
  // 22050 covers every current Rhasspy voice and keeps this path
  // dependency-free.
  Ok(pcm_to_wav(&pcm, 22050, 1, 16))
}

#[tauri::command]
pub async fn tts_list_installed_voices<R: Runtime>(
  app: AppHandle<R>,
) -> Result<Vec<InstalledVoice>, String> {
  let root = tts_root(&app)?;
  if !root.exists() {
    return Ok(Vec::new());
  }
  cleanup_stale_downloads(&root).await;
  let mut out = Vec::new();
  let mut providers = fs::read_dir(&root)
    .await
    .map_err(|e| format!("read_dir tts-models failed: {e}"))?;
  while let Some(provider_entry) = providers
    .next_entry()
    .await
    .map_err(|e| format!("read_dir provider entry failed: {e}"))?
  {
    let provider_path = provider_entry.path();
    if !provider_path.is_dir() {
      continue;
    }
    let provider = provider_entry.file_name().to_string_lossy().into_owned();
    let mut voices = fs::read_dir(&provider_path)
      .await
      .map_err(|e| format!("read_dir provider failed: {e}"))?;
    while let Some(voice_entry) = voices
      .next_entry()
      .await
      .map_err(|e| format!("read_dir voice entry failed: {e}"))?
    {
      let voice_path = voice_entry.path();
      if !voice_path.is_dir() {
        continue;
      }
      let voice_id = voice_entry.file_name().to_string_lossy().into_owned();
      if provider == "piper" {
        let onnx = voice_path.join(format!("{voice_id}.onnx"));
        let json = voice_path.join(format!("{voice_id}.onnx.json"));
        if validate_piper_voice_files(&onnx, &json).await.is_err() {
          continue;
        }
      }
      let size_bytes = dir_size(&voice_path).await.unwrap_or(0);
      let installed_at = voice_path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
      out.push(InstalledVoice {
        provider: provider.clone(),
        voice_id,
        size_bytes,
        installed_at,
      });
    }
  }
  Ok(out)
}

#[tauri::command]
pub async fn tts_install_voice<R: Runtime>(
  app: AppHandle<R>,
  provider: String,
  voice_id: String,
) -> Result<InstalledVoice, String> {
  if provider != "piper" {
    return Err(format!("install for provider {provider} not supported in 11.A"));
  }
  let dir = voice_dir(&app, &provider, &voice_id)?;
  cleanup_stale_downloads(&tts_root(&app)?).await;
  fs::create_dir_all(&dir)
    .await
    .map_err(|e| format!("create voice dir failed: {e}"))?;

  let (lang_tag, locale_tag, speaker, quality) = parse_piper_voice_id(&voice_id)?;
  let onnx_url = format!(
    "{HUGGINGFACE_BASE}/{lang_tag}/{locale_tag}/{speaker}/{quality}/{voice_id}.onnx"
  );
  let json_url = format!("{HUGGINGFACE_BASE}/{lang_tag}/{locale_tag}/{speaker}/{quality}/{voice_id}.onnx.json");

  let onnx_path = dir.join(format!("{voice_id}.onnx"));
  let json_path = dir.join(format!("{voice_id}.onnx.json"));

  let install_result = async {
    // Tiny .json first; cheap to fail fast if the voice id doesn't map to
    // an actual Hugging Face path.
    download_with_progress(&app, &json_url, &json_path, &voice_id, false).await?;
    validate_piper_config_file(&json_path).await?;
    download_with_progress(&app, &onnx_url, &onnx_path, &voice_id, true).await?;
    validate_piper_voice_files(&onnx_path, &json_path).await
  }
  .await;
  if let Err(err) = install_result {
    cleanup_stale_downloads(&dir).await;
    let _ = fs::remove_dir_all(&dir).await;
    return Err(err);
  }

  let size_bytes = dir_size(&dir).await.unwrap_or(0);
  let installed_at = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0);
  Ok(InstalledVoice {
    provider,
    voice_id,
    size_bytes,
    installed_at,
  })
}

#[tauri::command]
pub async fn tts_delete_voice<R: Runtime>(
  app: AppHandle<R>,
  provider: String,
  voice_id: String,
) -> Result<(), String> {
  let dir = voice_dir(&app, &provider, &voice_id)?;
  if dir.exists() {
    fs::remove_dir_all(&dir)
      .await
      .map_err(|e| format!("remove voice dir failed: {e}"))?;
  }
  Ok(())
}

// ---------- internals ----------

async fn cleanup_stale_downloads(root: &Path) {
  if !root.exists() {
    return;
  }
  let mut stack = vec![root.to_path_buf()];
  while let Some(dir) = stack.pop() {
    let mut entries = match fs::read_dir(&dir).await {
      Ok(entries) => entries,
      Err(err) => {
        log::warn!("tts cleanup: read_dir {} failed: {err}", dir.display());
        continue;
      }
    };
    loop {
      let entry = match entries.next_entry().await {
        Ok(Some(entry)) => entry,
        Ok(None) => break,
        Err(err) => {
          log::warn!(
            "tts cleanup: read_dir entry {} failed: {err}",
            dir.display()
          );
          break;
        }
      };
      let path = entry.path();
      let meta = match entry.metadata().await {
        Ok(meta) => meta,
        Err(err) => {
          log::warn!("tts cleanup: metadata {} failed: {err}", path.display());
          continue;
        }
      };
      if meta.is_dir() {
        stack.push(path);
        continue;
      }
      let file_name = entry.file_name().to_string_lossy().into_owned();
      if file_name.ends_with(".download.tmp") {
        if let Err(err) = fs::remove_file(&path).await {
          log::warn!("tts cleanup: remove {} failed: {err}", path.display());
        }
      }
    }
  }
}

async fn validate_piper_voice_files(onnx: &Path, json: &Path) -> Result<(), String> {
  validate_piper_config_file(json).await?;
  let meta = fs::metadata(onnx)
    .await
    .map_err(|e| format!("model file missing: {} ({e})", onnx.display()))?;
  if !meta.is_file() {
    return Err(format!("model path is not a file: {}", onnx.display()));
  }
  if meta.len() < MIN_PIPER_ONNX_BYTES {
    return Err(format!(
      "model file is too small: {} bytes at {}",
      meta.len(),
      onnx.display()
    ));
  }
  Ok(())
}

async fn validate_piper_config_file(json: &Path) -> Result<(), String> {
  let raw = fs::read(json)
    .await
    .map_err(|e| format!("model config missing: {} ({e})", json.display()))?;
  if raw.is_empty() {
    return Err(format!("model config is empty: {}", json.display()));
  }
  serde_json::from_slice::<serde_json::Value>(&raw).map_err(|e| {
    format!(
      "model config is not valid JSON: {} ({e})",
      json.display()
    )
  })?;
  Ok(())
}

fn pcm_to_wav(pcm: &[u8], sample_rate: u32, channels: u16, bits: u16) -> Vec<u8> {
  let byte_rate = sample_rate * channels as u32 * (bits / 8) as u32;
  let block_align = channels * (bits / 8);
  let data_len = pcm.len() as u32;
  let chunk_size = 36 + data_len;

  let mut out = Vec::with_capacity(44 + pcm.len());
  out.extend_from_slice(b"RIFF");
  out.extend_from_slice(&chunk_size.to_le_bytes());
  out.extend_from_slice(b"WAVE");
  out.extend_from_slice(b"fmt ");
  out.extend_from_slice(&16u32.to_le_bytes());
  out.extend_from_slice(&1u16.to_le_bytes()); // PCM
  out.extend_from_slice(&channels.to_le_bytes());
  out.extend_from_slice(&sample_rate.to_le_bytes());
  out.extend_from_slice(&byte_rate.to_le_bytes());
  out.extend_from_slice(&block_align.to_le_bytes());
  out.extend_from_slice(&bits.to_le_bytes());
  out.extend_from_slice(b"data");
  out.extend_from_slice(&data_len.to_le_bytes());
  out.extend_from_slice(pcm);
  out
}

/// Parse a Piper voice id of the form `<lang>_<locale>-<speaker>-<quality>`,
/// e.g. `tr_TR-fettah-medium`, into `(lang, locale, speaker, quality)` tag
/// segments suitable for the Hugging Face URL layout.
fn parse_piper_voice_id(voice_id: &str) -> Result<(String, String, String, String), String> {
  let mut parts = voice_id.split('-');
  let head = parts
    .next()
    .ok_or_else(|| format!("malformed voice id: {voice_id}"))?;
  let speaker = parts
    .next()
    .ok_or_else(|| format!("malformed voice id: {voice_id}"))?
    .to_string();
  let quality = parts
    .next()
    .ok_or_else(|| format!("malformed voice id: {voice_id}"))?
    .to_string();
  if parts.next().is_some() {
    return Err(format!("malformed voice id (extra segment): {voice_id}"));
  }
  let mut head_parts = head.split('_');
  let lang = head_parts
    .next()
    .ok_or_else(|| format!("malformed voice id (lang): {voice_id}"))?
    .to_string();
  let locale = head_parts
    .next()
    .map(|s| format!("{lang}_{s}"))
    .ok_or_else(|| format!("malformed voice id (locale): {voice_id}"))?;
  Ok((lang, locale, speaker, quality))
}

async fn download_with_progress<R: Runtime>(
  app: &AppHandle<R>,
  url: &str,
  dest: &Path,
  voice_id: &str,
  emit_progress: bool,
) -> Result<(), String> {
  let tmp = dest.with_extension("download.tmp");
  let resp = reqwest::get(url)
    .await
    .map_err(|e| format!("download GET failed: {e}"))?;
  if !resp.status().is_success() {
    return Err(format!(
      "download {} returned HTTP {}",
      url,
      resp.status().as_u16()
    ));
  }
  let total = resp.content_length().unwrap_or(0);
  let mut out = fs::File::create(&tmp)
    .await
    .map_err(|e| format!("create tmp file failed: {e}"))?;
  let mut stream = resp.bytes_stream();
  let mut downloaded: u64 = 0;
  while let Some(chunk) = stream.next().await {
    let bytes = chunk.map_err(|e| format!("download stream error: {e}"))?;
    out.write_all(&bytes)
      .await
      .map_err(|e| format!("write chunk failed: {e}"))?;
    downloaded += bytes.len() as u64;
    if emit_progress {
      let _ = app.emit(
        "tts://install/progress",
        InstallProgress {
          voice_id: voice_id.to_string(),
          downloaded_bytes: downloaded,
          total_bytes: total,
        },
      );
    }
  }
  out
    .flush()
    .await
    .map_err(|e| format!("flush tmp file failed: {e}"))?;
  drop(out);
  fs::rename(&tmp, dest)
    .await
    .map_err(|e| format!("rename tmp→dest failed: {e}"))?;
  Ok(())
}

async fn dir_size(path: &Path) -> std::io::Result<u64> {
  let mut total: u64 = 0;
  let mut entries = fs::read_dir(path).await?;
  while let Some(entry) = entries.next_entry().await? {
    let meta = entry.metadata().await?;
    if meta.is_file() {
      total += meta.len();
    }
  }
  Ok(total)
}
