// Tauri shell entry point. Wires the plugin set + builds the system tray
// menu before handing control to the webview. Keep this module short —
// business logic lives in TS / React; this file is intentionally a thin
// integration layer.

mod keychain;
mod sysinfo;
mod tts;

use tauri::{
  menu::{
    AboutMetadata, Menu, MenuBuilder, MenuItem, MenuItemBuilder,
    PredefinedMenuItem, SubmenuBuilder,
  },
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Emitter, Manager,
};
// `RunEvent::Opened` is only compiled on macOS — it ships under
// `#[cfg(target_os = "macos")]` in `tauri-runtime` 2.11. Importing it
// unconditionally would break the Windows / Linux build.
#[cfg(target_os = "macos")]
use tauri::RunEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      None,
    ))
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![
      keychain::keychain_get,
      keychain::keychain_set,
      keychain::keychain_delete,
      keychain::keychain_list,
      tts::tts_piper_check_readiness,
      tts::tts_piper_synthesize,
      tts::tts_list_installed_voices,
      tts::tts_install_voice,
      tts::tts_delete_voice,
      sysinfo::sysinfo_probe,
      sysinfo::sysinfo_gpu,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      build_system_tray(app.handle())?;
      build_app_menu(app.handle())?;
      emit_args_open_files(app.handle());
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|_app_handle, _event| {
    // Phase 7.5.C — macOS routes "Open with TME" through this event.
    // Windows / Linux pass the path as a CLI argument; that path is
    // handled at setup time by `emit_args_open_files`. The cfg gate
    // matches the conditional compilation of `RunEvent::Opened` itself.
    #[cfg(target_os = "macos")]
    {
      if let RunEvent::Opened { urls } = &_event {
        for url in urls {
          let payload = url
            .to_file_path()
            .ok()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| url.to_string());
          let _ = _app_handle.emit("tme://open-file", payload);
        }
      }
    }
  });
}

// Phase 7.5.B — System tray + quick actions.
//
// We keep `show` + `quit` native because they only touch the Tauri window
// handle / process; the other menu items are routed to the webview via an
// `tme://tray/menu` event so the React layer can decide what "new note" /
// "today's daily" / "open vault" mean given the current route + prefs.
//
// Tray menu labels are intentionally Turkish-only for v1 — TME's primary
// locale is TR and there is no way to update Tauri's native menu labels
// reactively once the tray is built. A future sub-phase can resolve the
// preferred locale from a Rust-readable config file at boot time.
fn build_system_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
  let new_note = MenuItem::with_id(
    app,
    "new-note",
    "Yeni not",
    true,
    None::<&str>,
  )?;
  let today = MenuItem::with_id(
    app,
    "today",
    "Bugünün notu",
    true,
    None::<&str>,
  )?;
  let open_vault = MenuItem::with_id(
    app,
    "open-vault",
    "Klasörü aç",
    true,
    None::<&str>,
  )?;
  let sep = PredefinedMenuItem::separator(app)?;
  let show = MenuItem::with_id(app, "show", "Göster", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;

  let menu = Menu::with_items(
    app,
    &[&new_note, &today, &open_vault, &sep, &show, &quit],
  )?;

  let icon = app
    .default_window_icon()
    .ok_or_else(|| {
      tauri::Error::AssetNotFound(
        "default window icon missing — bundle the tray icon set".into(),
      )
    })?
    .clone();

  let _tray = TrayIconBuilder::with_id("tme-main")
    .icon(icon)
    .tooltip("Teach Me Everything")
    .menu(&menu)
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id.as_ref() {
      "show" => raise_main_window(app),
      "quit" => app.exit(0),
      other => {
        // Forward to JS. The webview decides what to do — usually
        // dispatched as a window CustomEvent in TrayMount.tsx.
        let _ = app.emit("tme://tray/menu", other.to_string());
      }
    })
    .on_tray_icon_event(|tray, event| {
      // Left-click on the tray icon itself raises the main window. Right
      // click triggers the menu via Tauri's default behaviour.
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        raise_main_window(tray.app_handle());
      }
    })
    .build(app)?;

  Ok(())
}

fn raise_main_window(app: &tauri::AppHandle) {
  if let Some(win) = app.get_webview_window("main") {
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
  }
}

// Phase 7.5.D — Native application menu + keyboard shortcuts.
//
// macOS shows the menu in the system menu bar; Windows / Linux render it
// in the window's title bar. Custom menu items (Yeni not, Tercihler,
// Kenar çubuğunu aç/kapa) emit `tme://menu` events to the webview so the
// React tree can react. Predefined items (quit, copy, paste, fullscreen,
// etc.) are handled natively by Tauri / the OS and never reach JS.
//
// As with the tray, custom labels are Turkish-only for v1; predefined
// items are auto-localised by the OS.
fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
  let new_note = MenuItemBuilder::with_id("menu-new-note", "Yeni not")
    .accelerator("CmdOrCtrl+N")
    .build(app)?;
  let settings = MenuItemBuilder::with_id("menu-settings", "Tercihler…")
    .accelerator("CmdOrCtrl+,")
    .build(app)?;
  let toggle_sidebar =
    MenuItemBuilder::with_id("menu-toggle-sidebar", "Kenar çubuğunu aç/kapa")
      .accelerator("CmdOrCtrl+B")
      .build(app)?;
  let today_note = MenuItemBuilder::with_id("menu-today", "Bugünün notu")
    .accelerator("CmdOrCtrl+T")
    .build(app)?;
  let palette = MenuItemBuilder::with_id("menu-palette", "Komut paleti")
    .accelerator("CmdOrCtrl+K")
    .build(app)?;
  // PredefinedMenuItem::fullscreen toggles natively on macOS but is a
  // no-op on Windows / Linux (Tauri 2.x doesn't translate the menu role
  // there). Use a custom item with platform-appropriate accelerator and
  // toggle `set_fullscreen` ourselves in `on_menu_event` so behaviour is
  // identical across OSes.
  let fullscreen = MenuItemBuilder::with_id(
    "menu-fullscreen",
    "Tam ekran aç/kapa",
  )
  .accelerator("F11")
  .build(app)?;

  // macOS uses an "app menu" first slot (App name → About / Settings /
  // Hide / Quit). Windows/Linux have no such convention; the product
  // name lives in the title bar and About/Settings/Quit belong under
  // File/Help. Mirroring the macOS pattern on Win/Linux truncated
  // "Teach Me Everything" → "Teach Me E…" in the menu bar.

  #[cfg(target_os = "macos")]
  let app_submenu = SubmenuBuilder::new(app, "Teach Me Everything")
    .item(&PredefinedMenuItem::about(
      app,
      Some("Teach Me Everything"),
      Some(AboutMetadata::default()),
    )?)
    .separator()
    .item(&settings)
    .separator()
    .item(&PredefinedMenuItem::hide(app, None)?)
    .item(&PredefinedMenuItem::hide_others(app, None)?)
    .item(&PredefinedMenuItem::show_all(app, None)?)
    .separator()
    .item(&PredefinedMenuItem::quit(app, None)?)
    .build()?;

  #[allow(unused_mut)]
  let mut file_builder = SubmenuBuilder::new(app, "Dosya")
    .item(&new_note)
    .item(&today_note)
    .separator();
  #[cfg(not(target_os = "macos"))]
  {
    file_builder = file_builder.item(&settings).separator();
  }
  file_builder = file_builder.item(&PredefinedMenuItem::close_window(app, None)?);
  #[cfg(not(target_os = "macos"))]
  {
    file_builder = file_builder.item(&PredefinedMenuItem::quit(app, None)?);
  }
  let file_submenu = file_builder.build()?;

  let edit_submenu = SubmenuBuilder::new(app, "Düzen")
    .item(&PredefinedMenuItem::undo(app, None)?)
    .item(&PredefinedMenuItem::redo(app, None)?)
    .separator()
    .item(&PredefinedMenuItem::cut(app, None)?)
    .item(&PredefinedMenuItem::copy(app, None)?)
    .item(&PredefinedMenuItem::paste(app, None)?)
    .item(&PredefinedMenuItem::select_all(app, None)?)
    .build()?;

  let view_submenu = SubmenuBuilder::new(app, "Görünüm")
    .item(&toggle_sidebar)
    .item(&palette)
    .separator()
    .item(&fullscreen)
    .build()?;

  #[cfg(not(target_os = "macos"))]
  let help_submenu = SubmenuBuilder::new(app, "Yardım")
    .item(&PredefinedMenuItem::about(
      app,
      Some("Teach Me Everything"),
      Some(AboutMetadata::default()),
    )?)
    .build()?;

  #[cfg(target_os = "macos")]
  let menu = MenuBuilder::new(app)
    .item(&app_submenu)
    .item(&file_submenu)
    .item(&edit_submenu)
    .item(&view_submenu)
    .build()?;

  #[cfg(not(target_os = "macos"))]
  let menu = MenuBuilder::new(app)
    .item(&file_submenu)
    .item(&edit_submenu)
    .item(&view_submenu)
    .item(&help_submenu)
    .build()?;

  app.set_menu(menu)?;

  app.on_menu_event(|app, event| {
    let id = event.id.as_ref();

    // Native-handled items toggle window state directly without bouncing
    // through JS. Fullscreen is the canonical one — JS doesn't need to know
    // and the round-trip would just add latency + a visible flicker.
    if id == "menu-fullscreen" {
      if let Some(win) = app.get_webview_window("main") {
        let curr = win.is_fullscreen().unwrap_or(false);
        let _ = win.set_fullscreen(!curr);
      }
      return;
    }

    // Only the custom (non-predefined) ids route to JS. The OS-built
    // close-window / quit / cut / copy / paste / etc. items are handled
    // natively and never land here.
    let routed = match id {
      "menu-new-note" => Some("new-note"),
      "menu-today" => Some("today"),
      "menu-settings" => Some("settings"),
      "menu-toggle-sidebar" => Some("toggle-sidebar"),
      "menu-palette" => Some("palette"),
      _ => None,
    };
    if let Some(action) = routed {
      let _ = app.emit("tme://menu", action.to_string());
    }
  });

  Ok(())
}

// Phase 7.5.C — Windows / Linux deliver "Open with TME" via the command
// line. macOS uses RunEvent::Opened (handled in the top-level run loop).
// We do a permissive .md / .markdown check here so the JS layer never
// sees stray args (e.g. `--no-sandbox`, packaging flags). Non-existent
// paths are forwarded as-is — the JS side decides whether to surface a
// "file not found" toast or silently drop.
fn emit_args_open_files(app: &tauri::AppHandle) {
  for arg in std::env::args().skip(1) {
    let lower = arg.to_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".markdown") {
      let _ = app.emit("tme://open-file", arg);
    }
  }
}
