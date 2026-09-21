mod backend;
mod commands;

use tauri::Emitter;

/// Entry point called from `main.rs`.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 1) Launch the Python backend as a child process (sidecar).
            backend::spawn_backend(app.handle());
            // 2) Wait for it to accept connections, then push the real base URL
            //    to the UI so the frontend can talk to Python directly.
            if backend::wait_for_backend(backend::backend_port(), std::time::Duration::from_secs(20))
            {
                let _ = app.emit("backend-ready", backend::backend_base_url());
            } else {
                let _ = app.emit(
                    "backend-error",
                    "Python 后端在限定时间内未就绪（请确认已安装依赖且在 PATH 中可用）",
                );
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::backend_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Kill the embedded Python backend. Called after `run()` returns.
pub fn kill_backend() {
    backend::kill_backend();
}
