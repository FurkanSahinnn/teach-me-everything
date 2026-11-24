//! On-demand embedding model storage. Only curated Hugging Face repositories
//! can be downloaded, and only their declared ONNX/tokenizer files are served.

use std::{collections::HashSet, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::{fs, io::AsyncWriteExt};

const MODELS: &[(&str, &str)] = &[
  ("local-qwen3-0.6b", "onnx-community/Qwen3-Embedding-0.6B-ONNX"),
  ("local-embeddinggemma-2", "onnx-community/embeddinggemma-2-ONNX"),
  ("local-embeddinggemma-300m", "onnx-community/embeddinggemma-300m-ONNX"),
  ("local-minilm-multilingual", "Xenova/paraphrase-multilingual-MiniLM-L12-v2"),
  ("local-minilm-l6", "Xenova/all-MiniLM-L6-v2"),
  ("local-bge-m3", "Xenova/bge-m3"),
  ("local-e5-multilingual-small", "Xenova/multilingual-e5-small"),
  ("local-e5-multilingual-base", "Xenova/multilingual-e5-base"),
  ("local-e5-multilingual-large", "Xenova/multilingual-e5-large"),
  ("local-arctic-embed-m-v2", "Snowflake/snowflake-arctic-embed-m-v2.0"),
];

const ALLOWED_FILES: &[&str] = &[
  "config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
  "onnx/model_quantized.onnx", "onnx/model_quantized.onnx_data",
];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledEmbedModel {
  pub model_id: String,
  pub hf_repo: String,
  pub size_bytes: u64,
  pub installed_at: u64,
  pub files: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedReadiness {
  state: &'static str,
  model_id: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  size_bytes: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
  model_id: String,
  downloaded_bytes: u64,
  total_bytes: u64,
}

fn repo_for(id: &str) -> Result<&'static str, String> {
  MODELS.iter().find(|(known, _)| *known == id)
    .map(|(_, repo)| *repo)
    .ok_or_else(|| format!("unknown embedding model: {id}"))
}

fn root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
  Ok(app.path().app_data_dir()
    .map_err(|e| format!("appDataDir unavailable: {e}"))?
    .join("embed-models"))
}

fn model_dir<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<PathBuf, String> {
  repo_for(id)?;
  Ok(root(app)?.join(id))
}

fn files_are_valid(id: &str, files: &[String]) -> bool {
  let mut unique = HashSet::new();
  files.len() >= 3 && files.len() <= ALLOWED_FILES.len() &&
    files.iter().all(|f| ALLOWED_FILES.contains(&f.as_str()) && unique.insert(f)) &&
    files.iter().any(|f| f == "config.json") &&
    files.iter().any(|f| f == "tokenizer.json") &&
    files.iter().any(|f| f == "onnx/model_quantized.onnx") &&
    (!id.starts_with("local-embeddinggemma-") ||
      files.iter().any(|f| f == "onnx/model_quantized.onnx_data"))
}

fn read_manifest(dir: &Path, id: &str) -> Option<InstalledEmbedModel> {
  let raw = std::fs::read(dir.join("manifest.json")).ok()?;
  let manifest: InstalledEmbedModel = serde_json::from_slice(&raw).ok()?;
  if manifest.model_id != id || manifest.hf_repo != repo_for(id).ok()? ||
      !files_are_valid(id, &manifest.files) {
    return None;
  }
  if manifest.files.iter().any(|f| {
    std::fs::metadata(dir.join(f)).map(|m| !m.is_file() || m.len() == 0).unwrap_or(true)
  }) { return None; }
  Some(manifest)
}

#[tauri::command]
pub fn embed_list_installed_models<R: Runtime>(app: AppHandle<R>) -> Result<Vec<InstalledEmbedModel>, String> {
  let base = root(&app)?;
  Ok(MODELS.iter().filter_map(|(id, _)| read_manifest(&base.join(id), id)).collect())
}

#[tauri::command]
pub fn embed_check_readiness<R: Runtime>(app: AppHandle<R>, model_id: String) -> Result<EmbedReadiness, String> {
  let dir = model_dir(&app, &model_id)?;
  let installed = read_manifest(&dir, &model_id);
  Ok(EmbedReadiness {
    state: if installed.is_some() { "ready" } else { "missing-model" },
    model_id,
    size_bytes: installed.map(|m| m.size_bytes),
  })
}

#[tauri::command]
pub async fn embed_install_model<R: Runtime>(
  app: AppHandle<R>, model_id: String, hf_repo: String, files: Vec<String>, expected_bytes: u64,
) -> Result<InstalledEmbedModel, String> {
  if repo_for(&model_id)? != hf_repo || !files_are_valid(&model_id, &files) {
    return Err("embedding model does not match the curated catalog".into());
  }
  let dir = model_dir(&app, &model_id)?;
  if let Some(installed) = read_manifest(&dir, &model_id) { return Ok(installed); }
  let base = root(&app)?;
  fs::create_dir_all(&base).await.map_err(|e| e.to_string())?;
  let nonce = SystemTime::now().duration_since(UNIX_EPOCH)
    .map(|d| d.as_nanos()).unwrap_or(0);
  let staging = base.join(format!("{model_id}.{nonce}.installing"));
  fs::create_dir_all(&staging).await.map_err(|e| e.to_string())?;

  let result = async {
    let client = reqwest::Client::new();
    let mut downloaded = 0_u64;
    for file in &files {
      let url = format!("https://huggingface.co/{hf_repo}/resolve/main/{file}");
      let response = client.get(&url).send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?;
      let dest = staging.join(file);
      if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
      }
      let mut output = fs::File::create(&dest).await.map_err(|e| e.to_string())?;
      let mut stream = response.bytes_stream();
      let mut file_bytes = 0_u64;
      while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        output.write_all(&chunk).await.map_err(|e| e.to_string())?;
        file_bytes += chunk.len() as u64;
        if file_bytes > 2_000_000_000 { return Err("model file exceeds 2 GB limit".into()); }
        downloaded += chunk.len() as u64;
        let _ = app.emit("embed://install/progress", InstallProgress {
          model_id: model_id.clone(), downloaded_bytes: downloaded,
          total_bytes: expected_bytes.max(downloaded),
        });
      }
      output.flush().await.map_err(|e| e.to_string())?;
      if file_bytes == 0 { return Err(format!("empty model file: {file}")); }
      if file.ends_with(".onnx") && file_bytes < 100_000 {
        return Err(format!("invalid ONNX model file: {file}"));
      }
      if file.ends_with(".json") {
        let bytes = fs::read(&dest).await.map_err(|e| e.to_string())?;
        serde_json::from_slice::<serde_json::Value>(&bytes)
          .map_err(|e| format!("invalid JSON model file {file}: {e}"))?;
      }
    }
    let installed_at = SystemTime::now().duration_since(UNIX_EPOCH)
      .map(|d| d.as_millis() as u64).unwrap_or(0);
    let manifest = InstalledEmbedModel {
      model_id: model_id.clone(), hf_repo, size_bytes: downloaded, installed_at, files,
    };
    let raw = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
    fs::write(staging.join("manifest.json"), raw).await.map_err(|e| e.to_string())?;
    if dir.exists() { fs::remove_dir_all(&dir).await.map_err(|e| e.to_string())?; }
    fs::rename(&staging, &dir).await.map_err(|e| e.to_string())?;
    Ok(manifest)
  }.await;
  if result.is_err() { let _ = fs::remove_dir_all(&staging).await; }
  result
}

#[tauri::command]
pub async fn embed_delete_model<R: Runtime>(app: AppHandle<R>, model_id: String) -> Result<(), String> {
  let dir = model_dir(&app, &model_id)?;
  if dir.exists() { fs::remove_dir_all(dir).await.map_err(|e| e.to_string())?; }
  Ok(())
}

/// The app protocol reads only files in a validated installation manifest.
pub fn read_model_asset<R: Runtime>(app: &AppHandle<R>, path: &str) -> Option<(Vec<u8>, &'static str)> {
  let rest = path.strip_prefix("/__tme_embed_models/")?;
  let (id, file) = rest.split_once('/')?;
  if !ALLOWED_FILES.contains(&file) { return None; }
  let dir = model_dir(app, id).ok()?;
  let manifest = read_manifest(&dir, id)?;
  if !manifest.files.iter().any(|f| f == file) { return None; }
  let mime = if file.ends_with(".json") { "application/json" } else { "application/octet-stream" };
  Some((std::fs::read(dir.join(file)).ok()?, mime))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn curated_files_reject_extra_paths() {
    assert!(files_are_valid("local-minilm-l6", &[
      "config.json".into(), "tokenizer.json".into(), "onnx/model_quantized.onnx".into(),
    ]));
    assert!(!files_are_valid("local-minilm-l6", &[
      "config.json".into(), "tokenizer.json".into(), "../secret".into(),
    ]));
    assert!(!files_are_valid("local-embeddinggemma-2", &[
      "config.json".into(), "tokenizer.json".into(), "onnx/model_quantized.onnx".into(),
    ]));
    assert!(repo_for("../../private").is_err());
  }
}
