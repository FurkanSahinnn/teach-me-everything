// Tauri shell entry point. Wires the plugin set + builds the system tray
// menu before handing control to the webview. Keep this module short —
// business logic lives in TS / React; this file is intentionally a thin
// integration layer.

mod keychain;
mod sysinfo;
mod tts;

use std::borrow::Cow;

use tauri::{
  http::{header, Request, Response, StatusCode},
  menu::{
    AboutMetadata, Menu, MenuBuilder, MenuItem, MenuItemBuilder,
    PredefinedMenuItem, SubmenuBuilder,
  },
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Emitter, Manager, Runtime, UriSchemeContext,
};
// `RunEvent::Opened` is only compiled on macOS — it ships under
// `#[cfg(target_os = "macos")]` in `tauri-runtime` 2.11. Importing it
// unconditionally would break the Windows / Linux build.
#[cfg(target_os = "macos")]
use tauri::RunEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    // Static-export SPA fallback. Replaces Tauri's built-in `tauri://` asset
    // handler so a request for a runtime workspace route (`/w/<id>/…`) that
    // `output: export` never emitted falls back to the `/w/_/…` placeholder
    // shell instead of 404ing. Without this, clicking a workspace card shows
    // "Sayfa bulunamadı". See `serve_export_asset` / `export_shell_fallback`.
    .register_uri_scheme_protocol("tauri", |ctx, request| {
      serve_export_asset(ctx, request)
    })
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

// === Static-export SPA fallback ===
//
// `output: export` only pre-renders the `/w/_/…` placeholder shell — real
// workspace / lesson / source / podcast / roadmap ids are user-generated at
// runtime, so no per-id HTML or RSC segment file exists. Tauri's built-in
// asset resolver 404s on any path it can't map to a file, so a hard navigation
// (or the Next.js RSC segment fetch that precedes a soft navigation) to
// `/w/<real-id>/…` fails. We rewrite the runtime ids back onto the emitted `_`
// shell so the asset exists; the React page then recovers the real id from
// `location.pathname` (see `src/lib/utils/route-params.ts`).

/// Rewrites a workspace dynamic-route asset path onto the `/w/_/…` shell that
/// static export actually emitted. Returns `None` for paths that need no
/// rewrite (non-workspace routes, or already-`_` shell paths).
fn export_shell_fallback(path: &str) -> Option<String> {
  let mut segs: Vec<String> = path.split('/').map(str::to_string).collect();
  // Leading slash → segs[0] == "". Workspace routes look like ["", "w", id, …].
  if segs.len() < 3 || segs[1] != "w" {
    return None;
  }

  // The Next.js static-export marker (`__next.*`) and the Next 16 segment-cache
  // placeholder tokens (`$d$<param>`) begin the RSC segment-tree encoding —
  // e.g. `/w/<id>/read/<sourceId>/__next.w/$d$id/read/$d$sourceId/__PAGE__.txt`.
  // That suffix is keyed off PLACEHOLDER tokens, not the runtime ids, so it is
  // identical for every workspace and must pass through byte-for-byte; only the
  // leading *page-path* ids are rewritten onto the `_` shell. Rewriting inside
  // the suffix (the recurring `read`/`study`/… keyword, or a `$d$…` token)
  // would point at a file that was never emitted → a spurious segment 404.
  let is_tree_marker = |s: &str| s.starts_with("__next") || s.starts_with("$d$");

  let mut changed = false;
  if !segs[2].is_empty() && segs[2] != "_" && !is_tree_marker(&segs[2]) {
    segs[2] = "_".to_string();
    changed = true;
  }

  // The segment directly after one of these static parents is itself a runtime
  // id (`/read/<sourceId>`, `/roadmap/<roadmapId>`, `/study/<lessonId>`,
  // `/audio/<podcastId>`). `/study/journal` is a STATIC sibling route, not a
  // lessonId, so it must NOT be rewritten.
  //
  // Note: `/w/<id>/chat` (the workspace chat) is a leaf route with no dynamic
  // child segment — like `/w/<id>/cards` — so it is fully handled by the
  // `segs[2]` workspace-id rewrite above and is NOT a dynamic parent here.
  const DYN_PARENTS: [&str; 4] = ["audio", "read", "study", "roadmap"];
  let mut i = 3;
  while i + 1 < segs.len() {
    if is_tree_marker(&segs[i]) {
      break;
    }
    let is_dyn = DYN_PARENTS.contains(&segs[i].as_str());
    let child = &segs[i + 1];
    let rewritable = is_dyn
      && !child.is_empty()
      && child != "_"
      && !is_tree_marker(child)
      && !(segs[i] == "study" && child == "journal");
    if rewritable {
      segs[i + 1] = "_".to_string();
      changed = true;
    }
    i += 1;
  }

  if changed {
    Some(segs.join("/"))
  } else {
    None
  }
}

/// Custom `tauri://` asset handler. For every existing asset this behaves
/// exactly like the built-in handler (same `asset_resolver`); only a miss on a
/// `/w/<id>/…` path triggers the placeholder-shell fallback.
fn serve_export_asset<R: Runtime>(
  ctx: UriSchemeContext<'_, R>,
  request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
  let resolver = ctx.app_handle().asset_resolver();
  // `request.uri().path()` is the leading-slash, host-stripped path on every
  // platform (sidesteps the Windows `tauri.localhost` host); `asset_resolver`
  // percent-decodes and maps directory paths to `index.html` internally.
  let path = request.uri().path().to_string();

  let asset = resolver.get(path.clone()).or_else(|| {
    export_shell_fallback(&path).and_then(|fallback| resolver.get(fallback))
  });

  match asset {
    Some(asset) => {
      let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, asset.mime_type);
      if let Some(csp) = asset.csp_header {
        builder = builder.header("Content-Security-Policy", csp);
      }
      builder
        .body(Cow::Owned(asset.bytes))
        .unwrap_or_else(|_| Response::new(Cow::Borrowed(b"".as_slice())))
    }
    None => Response::builder()
      .status(StatusCode::NOT_FOUND)
      .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
      .body(Cow::Borrowed(b"404 Not Found".as_slice()))
      .unwrap_or_else(|_| Response::new(Cow::Borrowed(b"".as_slice()))),
  }
}

#[cfg(test)]
mod export_fallback_tests {
  use super::export_shell_fallback;

  #[test]
  fn rewrites_workspace_id() {
    assert_eq!(export_shell_fallback("/w/abc"), Some("/w/_".to_string()));
    assert_eq!(export_shell_fallback("/w/abc/"), Some("/w/_/".to_string()));
    assert_eq!(
      export_shell_fallback("/w/abc/cards/"),
      Some("/w/_/cards/".to_string())
    );
    // Workspace chat is a leaf route like cards — covered by the segs[2]
    // workspace-id rewrite, no dynamic-parent handling needed.
    assert_eq!(
      export_shell_fallback("/w/abc/chat/"),
      Some("/w/_/chat/".to_string())
    );
    assert_eq!(
      export_shell_fallback("/w/abc/chat"),
      Some("/w/_/chat".to_string())
    );
  }

  #[test]
  fn rewrites_deep_dynamic_ids() {
    assert_eq!(
      export_shell_fallback("/w/abc/read/src9/"),
      Some("/w/_/read/_/".to_string())
    );
    assert_eq!(
      export_shell_fallback("/w/abc/roadmap/rm2"),
      Some("/w/_/roadmap/_".to_string())
    );
    assert_eq!(
      export_shell_fallback("/w/abc/audio/pod4/"),
      Some("/w/_/audio/_/".to_string())
    );
    assert_eq!(
      export_shell_fallback("/w/abc/study/les3"),
      Some("/w/_/study/_".to_string())
    );
  }

  #[test]
  fn preserves_static_study_journal() {
    assert_eq!(
      export_shell_fallback("/w/abc/study/journal/"),
      Some("/w/_/study/journal/".to_string())
    );
  }

  #[test]
  fn preserves_rsc_segment_tree_tokens() {
    // Next 16 segment-cache RSC URL for a deep dynamic route. ONLY the leading
    // page-path ids (abc, src9) become `_`; the `__next.*` marker, the `$d$…`
    // placeholder tokens, and the recurring `read` keyword inside the tree must
    // survive verbatim or the prefetch 404s (the file was emitted under those
    // exact placeholder names, never under `_`).
    assert_eq!(
      export_shell_fallback(
        "/w/abc/read/src9/__next.w/$d$id/read/$d$sourceId/__PAGE__.txt"
      ),
      Some(
        "/w/_/read/_/__next.w/$d$id/read/$d$sourceId/__PAGE__.txt".to_string()
      )
    );
    assert_eq!(
      export_shell_fallback(
        "/w/abc/study/les3/__next.w/$d$id/study/$d$lessonId/__PAGE__.txt"
      ),
      Some(
        "/w/_/study/_/__next.w/$d$id/study/$d$lessonId/__PAGE__.txt".to_string()
      )
    );
    // Shallow (single dynamic param) routes use a dotted single-segment tree;
    // only the page-path id is rewritten.
    assert_eq!(
      export_shell_fallback("/w/abc/research/__next.w.$d$id.research.txt"),
      Some("/w/_/research/__next.w.$d$id.research.txt".to_string())
    );
  }

  #[test]
  fn no_rewrite_for_shell_or_non_workspace() {
    assert_eq!(export_shell_fallback("/w/_/cards/"), None);
    assert_eq!(export_shell_fallback("/dashboard/"), None);
    assert_eq!(export_shell_fallback("/settings/"), None);
    assert_eq!(export_shell_fallback("/"), None);
    assert_eq!(export_shell_fallback("/w/"), None);
  }
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
