// Phase 11.B — Cross-platform system probe for the TTS compatibility
// check.
//
// Two commands the JS layer invokes via the standard Tauri `invoke`
// bridge:
//
//   sysinfo_probe()
//       → { totalRamBytes, availableRamBytes, cpuCores,
//           freeDiskBytes, osName, osVersion, arch }
//
//   sysinfo_gpu()
//       → { present: bool, names: Vec<String> }
//
// RAM / CPU / disk come from the `sysinfo` crate. GPU detection is
// intentionally *not* a Rust dependency — we spawn platform-specific
// shell commands (wmic on Windows, system_profiler on macOS, lspci on
// Linux) so the binary doesn't pick up heavy graphics crates like
// wgpu / ash just to learn whether a GPU is present.
//
// Both commands tolerate failure: a GPU probe error never crashes the
// renderer; we return `{present: false, names: []}` so the JS layer
// renders the "GPU not detected" branch instead of a generic error.

use serde::Serialize;
use std::process::Command;
use sysinfo::{Disks, System};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SysInfo {
  total_ram_bytes: u64,
  available_ram_bytes: u64,
  cpu_cores: usize,
  free_disk_bytes: u64,
  os_name: String,
  os_version: String,
  arch: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
  present: bool,
  names: Vec<String>,
  total_vram_bytes: Option<u64>,
}

struct GpuProbe {
  names: Vec<String>,
  total_vram_bytes: Option<u64>,
}

#[tauri::command]
pub async fn sysinfo_probe() -> Result<SysInfo, String> {
  // `new_all()` creates a fully populated `System` and refreshes RAM /
  // CPU / process tables at construction; we still call `refresh_all()`
  // so we read the freshest values rather than the snapshot frozen at
  // app boot.
  let mut sys = System::new_all();
  sys.refresh_memory();
  sys.refresh_cpu_usage();

  // Disks aren't on the `System` struct in sysinfo 0.32 — they live on a
  // separate `Disks` collection. We take the largest `available_space`
  // across mounted disks because TTS models go under appDataDir and the
  // user's home drive is usually the largest of the mounts.
  let disks = Disks::new_with_refreshed_list();
  let free_disk_bytes: u64 = disks
    .iter()
    .map(|d| d.available_space())
    .max()
    .unwrap_or(0);

  Ok(SysInfo {
    total_ram_bytes: sys.total_memory(),
    available_ram_bytes: sys.available_memory(),
    cpu_cores: sys.cpus().len(),
    free_disk_bytes,
    os_name: System::name().unwrap_or_else(|| "unknown".to_string()),
    os_version: System::os_version().unwrap_or_else(|| "unknown".to_string()),
    arch: std::env::consts::ARCH,
  })
}

#[tauri::command]
pub async fn sysinfo_gpu() -> Result<GpuInfo, String> {
  // Platform dispatch. Each branch parses the platform-native enumerator
  // and returns a deduplicated list of GPU names. A probe failure is
  // collapsed into `{present: false, names: []}` rather than an `Err`
  // so the JS layer always renders a usable compatibility chip — VRAM
  // detection is the 11.D responsibility, "GPU present yes/no + name"
  // is enough for 11.B's traffic-light heuristic.
  let probe = if cfg!(target_os = "windows") {
    probe_windows_gpu().unwrap_or_else(empty_gpu_probe)
  } else if cfg!(target_os = "macos") {
    probe_macos_gpu().unwrap_or_else(empty_gpu_probe)
  } else if cfg!(target_os = "linux") {
    probe_linux_gpu().unwrap_or_else(empty_gpu_probe)
  } else {
    empty_gpu_probe()
  };

  Ok(GpuInfo {
    present: !probe.names.is_empty(),
    names: probe.names,
    total_vram_bytes: probe.total_vram_bytes,
  })
}

fn empty_gpu_probe() -> GpuProbe {
  GpuProbe {
    names: Vec::new(),
    total_vram_bytes: None,
  }
}

fn probe_windows_gpu() -> Option<GpuProbe> {
  // `wmic path win32_VideoController get name /format:list` returns one
  // record per adapter as `Name=...`. wmic is deprecated on Windows 11
  // but still ships through 2026; PowerShell `Get-CimInstance` is the
  // forward path. We try wmic first and fall back to PowerShell.
  let out = Command::new("wmic")
    .args([
      "path",
      "win32_VideoController",
      "get",
      "name,AdapterRAM",
      "/format:list",
    ])
    .output()
    .ok()?;
  if out.status.success() {
    let text = String::from_utf8_lossy(&out.stdout);
    let probe = parse_windows_video_controller_list(&text);
    if !probe.names.is_empty() {
      return Some(probe);
    }
  }
  // Fallback for Win11 builds where wmic was removed.
  let out = Command::new("powershell")
    .args([
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_VideoController | ForEach-Object { \"Name=$($_.Name)\"; \"AdapterRAM=$($_.AdapterRAM)\"; \"\" }",
    ])
    .output()
    .ok()?;
  if !out.status.success() {
    return None;
  }
  let text = String::from_utf8_lossy(&out.stdout);
  let probe = parse_windows_video_controller_list(&text);
  if probe.names.is_empty() {
    None
  } else {
    Some(probe)
  }
}

fn probe_macos_gpu() -> Option<GpuProbe> {
  // `system_profiler SPDisplaysDataType -json` prints structured GPU
  // info. We parse leniently so a schema change in a future macOS
  // doesn't take the whole probe down — find every "sppci_model" or
  // "_name" string under SPDisplaysDataType.
  let out = Command::new("system_profiler")
    .args(["SPDisplaysDataType", "-json"])
    .output()
    .ok()?;
  if !out.status.success() {
    return None;
  }
  let text = String::from_utf8_lossy(&out.stdout);
  let parsed: serde_json::Value = serde_json::from_str(&text).ok()?;
  let arr = parsed.get("SPDisplaysDataType")?.as_array()?;
  let mut names = Vec::new();
  let mut total_vram_bytes = None;
  for entry in arr {
    let Some(obj) = entry.as_object() else {
      continue;
    };
    if let Some(name) = obj
      .get("sppci_model")
      .or_else(|| obj.get("_name"))
      .and_then(|v| v.as_str())
      .map(str::trim)
      .filter(|s| !s.is_empty())
    {
      names.push(name.to_string());
    }
    if let Some(bytes) = obj
      .get("spdisplays_vram")
      .or_else(|| obj.get("sppci_vram"))
      .and_then(|v| v.as_str())
      .and_then(parse_vram_bytes)
    {
      total_vram_bytes = Some(total_vram_bytes.unwrap_or(0) + bytes);
    }
  }
  if names.is_empty() {
    None
  } else {
    Some(GpuProbe {
      names,
      total_vram_bytes,
    })
  }
}

fn probe_linux_gpu() -> Option<GpuProbe> {
  // `lspci -mm` outputs space-separated machine-readable fields with the
  // device class as the second column. We filter the VGA / 3D / Display
  // classes which together cover discrete GPUs and integrated graphics.
  let out = Command::new("lspci").arg("-mm").output().ok()?;
  if !out.status.success() {
    // lspci may not be installed on minimal containers. Treat as
    // "no GPU detected" rather than propagating the error.
    return probe_linux_nvidia_vram();
  }
  let text = String::from_utf8_lossy(&out.stdout);
  let names: Vec<String> = text
    .lines()
    .filter(|line| {
      // Class column is the second quoted field; we just look for the
      // substring which is robust enough for the v1 chip.
      line.contains("\"VGA compatible controller\"")
        || line.contains("\"3D controller\"")
        || line.contains("\"Display controller\"")
    })
    .filter_map(parse_lspci_line)
    .collect();
  if names.is_empty() {
    None
  } else {
    let total_vram_bytes =
      probe_linux_nvidia_vram().and_then(|probe| probe.total_vram_bytes);
    Some(GpuProbe {
      names,
      total_vram_bytes,
    })
  }
}

fn probe_linux_nvidia_vram() -> Option<GpuProbe> {
  let out = Command::new("nvidia-smi")
    .args([
      "--query-gpu=name,memory.total",
      "--format=csv,noheader,nounits",
    ])
    .output()
    .ok()?;
  if !out.status.success() {
    return None;
  }
  let text = String::from_utf8_lossy(&out.stdout);
  let mut names = Vec::new();
  let mut total_vram_bytes = None;
  for line in text.lines() {
    let mut parts = line.split(',');
    let name = parts.next().map(str::trim).unwrap_or_default();
    if !name.is_empty() {
      names.push(name.to_string());
    }
    if let Some(mib) = parts
      .next()
      .map(str::trim)
      .and_then(|s| s.parse::<u64>().ok())
    {
      total_vram_bytes = Some(total_vram_bytes.unwrap_or(0) + mib * 1024 * 1024);
    }
  }
  if names.is_empty() {
    None
  } else {
    Some(GpuProbe {
      names,
      total_vram_bytes,
    })
  }
}

fn parse_lspci_line(line: &str) -> Option<String> {
  // -mm format: `slot "class" "vendor" "device" "rev" "progif" ...`
  // Quoted fields can contain spaces — splitting by `"` then keeping the
  // odd-indexed pieces (1, 3, 5, ...) gives us class/vendor/device.
  let parts: Vec<&str> = line.split('"').collect();
  // [slot, " ", class, " ", vendor, " ", device, ...] — device sits at
  if parts.len() < 6 {
    return None;
  }
  let vendor = parts.get(3)?.trim();
  let device = parts.get(5)?.trim();
  if vendor.is_empty() && device.is_empty() {
    return None;
  }
  Some(if vendor.is_empty() {
    device.to_string()
  } else if device.is_empty() {
    vendor.to_string()
  } else {
    format!("{vendor} {device}")
  })
}

fn parse_windows_video_controller_list(text: &str) -> GpuProbe {
  let mut names = Vec::new();
  let mut total_vram_bytes = None;
  for line in text.lines() {
    let line = line.trim();
    if let Some(name) = line.strip_prefix("Name=") {
      let name = name.trim();
      if !name.is_empty() {
        names.push(name.to_string());
      }
    } else if let Some(bytes) = line
      .strip_prefix("AdapterRAM=")
      .and_then(|s| s.trim().parse::<u64>().ok())
      .filter(|bytes| *bytes > 0)
    {
      total_vram_bytes = Some(total_vram_bytes.unwrap_or(0) + bytes);
    }
  }
  GpuProbe {
    names,
    total_vram_bytes,
  }
}

fn parse_vram_bytes(raw: &str) -> Option<u64> {
  let normalized = raw.trim().replace(',', ".");
  let mut parts = normalized.split_whitespace();
  let amount = parts.next()?.parse::<f64>().ok()?;
  let unit = parts.next().unwrap_or("MB").to_ascii_lowercase();
  let multiplier = if unit.starts_with("gb") {
    1024_f64 * 1024_f64 * 1024_f64
  } else if unit.starts_with("mb") {
    1024_f64 * 1024_f64
  } else if unit.starts_with("kb") {
    1024_f64
  } else {
    1_f64
  };
  Some((amount * multiplier).round() as u64)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_lspci_intel_iris() {
    let line = "00:02.0 \"VGA compatible controller\" \"Intel Corporation\" \"Iris Plus Graphics\" -r07 \"Dell\" \"Inspiron\"";
    assert_eq!(
      parse_lspci_line(line).as_deref(),
      Some("Intel Corporation Iris Plus Graphics")
    );
  }

  #[test]
  fn parses_lspci_nvidia() {
    let line = "01:00.0 \"3D controller\" \"NVIDIA Corporation\" \"GA106M [GeForce RTX 3060 Mobile]\" -ra1 \"Dell\" \"\"";
    assert_eq!(
      parse_lspci_line(line).as_deref(),
      Some("NVIDIA Corporation GA106M [GeForce RTX 3060 Mobile]")
    );
  }

  #[test]
  fn parses_lspci_returns_none_on_garbage() {
    assert_eq!(parse_lspci_line("not a real line"), None);
  }

  #[test]
  fn parses_windows_video_controller_vram() {
    let probe = parse_windows_video_controller_list(
      "AdapterRAM=8589934592\r\nName=NVIDIA RTX 4070\r\n\r\nAdapterRAM=536870912\r\nName=Intel UHD\r\n",
    );

    assert_eq!(probe.names, vec!["NVIDIA RTX 4070", "Intel UHD"]);
    assert_eq!(probe.total_vram_bytes, Some(9_126_805_504));
  }

  #[test]
  fn parses_vram_units() {
    assert_eq!(parse_vram_bytes("8 GB"), Some(8 * 1024 * 1024 * 1024));
    assert_eq!(parse_vram_bytes("512 MB"), Some(512 * 1024 * 1024));
    assert_eq!(parse_vram_bytes("1,5 GB"), Some(1_610_612_736));
  }
}
