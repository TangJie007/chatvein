// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Run the Tauri event loop; blocks until all windows are closed.
    chatvein_lib::run();
    // Ensure the embedded Python backend process is terminated on exit.
    chatvein_lib::kill_backend();
}
