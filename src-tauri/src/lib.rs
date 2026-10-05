mod debug;
mod pdf;
mod runner;
mod terminal;

use tauri::{Emitter, Manager};

/// The file path among command-line arguments, if any (skips the program itself and flags).
fn file_arg(args: &[String]) -> Option<String> {
    args.iter().skip(1).find(|arg| !arg.starts_with('-')).cloned()
}

/// The file the app was launched with (e.g. "Open with" / double-click in Explorer), if any.
#[tauri::command]
fn startup_file() -> Option<String> {
    file_arg(&std::env::args().collect::<Vec<_>>())
}

/// The page behind `platform.htmlPreviewUrl` (http://preview.localhost/ on Windows).
/// The app's CSP forbids inline scripts, and a srcdoc frame would inherit it, so the
/// HTML preview loads this page instead: it writes whatever HTML the editor posts to
/// it. It has its own loose CSP, and the editor shows it in a sandboxed iframe
/// without allow-same-origin: the opaque origin ("null") is what makes Tauri refuse
/// IPC from it (checked in the built app), so never add allow-same-origin there.
const PREVIEW_PAGE: &str = r#"<!doctype html><meta charset="utf-8"><script>
addEventListener('message', function show(event) {
  removeEventListener('message', show);
  document.open();
  document.write(String(event.data));
  document.close();
});
</script>"#;

const PREVIEW_CSP: &str = "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'";

fn preview_response() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", PREVIEW_CSP)
        .body(PREVIEW_PAGE.as_bytes().to_vec())
        .expect("static preview response")
}

/// Stop terminals and debug adapters left over from before the page (re)loaded.
#[tauri::command]
fn processes_reset(terminals: tauri::State<'_, terminal::Terminals>, adapters: tauri::State<'_, debug::Adapters>) {
    terminal::kill_all(&terminals);
    debug::kill_all(&adapters);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch ("Open with" while the app is open) hands its
        // file to this window as a new tab instead of starting another instance.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(path) = file_arg(&args) {
                let _ = app.emit("open-file", path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol("preview", |_ctx, _request| preview_response())
        .manage(terminal::Terminals::default())
        .manage(debug::Adapters::default())
        .invoke_handler(tauri::generate_handler![
            startup_file,
            processes_reset,
            runner::run_program,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            debug::adapter_start,
            debug::adapter_send,
            debug::adapter_kill,
            debug::free_port,
            debug::inspector_url,
            pdf::print_to_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
