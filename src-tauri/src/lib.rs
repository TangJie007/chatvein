mod backend;
mod commands;

use tauri::Emitter;

/// Shared application state. The HTTP client lives here so the message-layer
/// commands can reuse a single connection pool when proxying to Python.
pub struct AppState {
    pub http: reqwest::Client,
}

/// Entry point called from `main.rs`.
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 1) Launch the Python backend as a child process (sidecar).
            backend::spawn_backend(app.handle());
            // 2) Wait for it to accept connections, then notify the UI.
            let ready =
                backend::wait_for_backend(backend::BACKEND_PORT, std::time::Duration::from_secs(20));
            if ready {
                let _ = app.emit("backend-ready", true);
            } else {
                let _ = app.emit(
                    "backend-error",
                    "Python 后端在限定时间内未就绪（请确认已安装依赖且在 PATH 中可用）",
                );
            }
            Ok(())
        })
        .manage(AppState {
            http: reqwest::Client::new(),
        })
        .invoke_handler(tauri::generate_handler![
            commands::backend_health,
            commands::backend_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Kill the embedded Python backend. Called after `run()` returns.
pub fn kill_backend() {
    backend::kill_backend();
}
