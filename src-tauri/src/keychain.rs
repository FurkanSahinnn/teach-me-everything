// Phase 8.A — BYOK keychain bridge.
//
// Thin Rust wrapper around the OS-native credential store (macOS
// Keychain Services / Windows Credential Manager / Linux Secret
// Service via libsecret) using the `keyring` crate. The JS layer
// invokes these commands to read/write/delete API keys without ever
// holding the raw bytes in plaintext-on-disk form.
//
// We namespace under a single service identifier (`com.tme.byok`) and
// use the provider id (e.g. "anthropic", "openai", "custom:my-endpoint")
// as the per-entry username. A reserved `__registry__` entry holds the
// JSON list of provisioned providers so the JS layer can enumerate
// without an OS-specific list API (keyring-rs has none uniformly).
//
// Set/Delete operations transactionally update the registry — if the
// registry write fails after the secret was already written, the
// command surfaces the registry error to TS so the next list() can
// observe the inconsistency and a re-sync can be triggered.

use keyring::Entry;
use serde_json::{json, Value};

const KEYCHAIN_SERVICE: &str = "com.tme.byok";
const REGISTRY_USERNAME: &str = "__registry__";
const MAX_PROVIDER_ID_LEN: usize = 128;

fn validate_provider(provider: &str) -> Result<(), String> {
  if provider == REGISTRY_USERNAME {
    return Err("provider id is reserved".to_string());
  }
  if provider.is_empty() {
    return Err("provider id cannot be empty".to_string());
  }
  if provider.len() > MAX_PROVIDER_ID_LEN {
    return Err("provider id too long".to_string());
  }
  Ok(())
}

fn make_entry(username: &str) -> Result<Entry, String> {
  Entry::new(KEYCHAIN_SERVICE, username).map_err(|e| e.to_string())
}

fn read_registry() -> Result<Vec<String>, String> {
  let entry = make_entry(REGISTRY_USERNAME)?;
  match entry.get_password() {
    Ok(json) => {
      let parsed: Value =
        serde_json::from_str(&json).map_err(|e| e.to_string())?;
      let arr = parsed
        .get("providers")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
      Ok(
        arr
          .into_iter()
          .filter_map(|v| v.as_str().map(|s| s.to_string()))
          .collect(),
      )
    }
    Err(keyring::Error::NoEntry) => Ok(Vec::new()),
    Err(e) => Err(e.to_string()),
  }
}

fn write_registry(providers: &[String]) -> Result<(), String> {
  let entry = make_entry(REGISTRY_USERNAME)?;
  let json = json!({ "v": 1, "providers": providers }).to_string();
  entry.set_password(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn keychain_get(provider: String) -> Result<Option<String>, String> {
  validate_provider(&provider)?;
  let entry = make_entry(&provider)?;
  match entry.get_password() {
    Ok(secret) => Ok(Some(secret)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
pub fn keychain_set(provider: String, secret: String) -> Result<(), String> {
  validate_provider(&provider)?;
  let entry = make_entry(&provider)?;
  entry.set_password(&secret).map_err(|e| e.to_string())?;
  let mut providers = read_registry()?;
  if !providers.iter().any(|p| p == &provider) {
    providers.push(provider);
    providers.sort();
    write_registry(&providers)?;
  }
  Ok(())
}

#[tauri::command]
pub fn keychain_delete(provider: String) -> Result<(), String> {
  validate_provider(&provider)?;
  let entry = make_entry(&provider)?;
  match entry.delete_credential() {
    Ok(_) | Err(keyring::Error::NoEntry) => {}
    Err(e) => return Err(e.to_string()),
  }
  let mut providers = read_registry()?;
  let before = providers.len();
  providers.retain(|p| p != &provider);
  if providers.len() != before {
    write_registry(&providers)?;
  }
  Ok(())
}

#[tauri::command]
pub fn keychain_list() -> Result<Vec<String>, String> {
  read_registry()
}
