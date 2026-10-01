mod runner;

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
        .invoke_handler(tauri::generate_handler![startup_file, runner::run_program])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
