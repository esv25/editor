mod runner;

/// The file the app was launched with (e.g. "Open with" / double-click in Explorer), if any.
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args().skip(1).find(|arg| !arg.starts_with('-'))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![startup_file, runner::run_program])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
