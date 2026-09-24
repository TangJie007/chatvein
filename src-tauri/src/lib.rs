mod backend;
mod commands;

use tauri::Emitter;
use tauri::Manager;

/// Entry point called from `main.rs`.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 立刻拉起 Python；就绪探测放到后台线程，不阻塞窗口显示。
            backend::spawn_backend(app.handle());
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if backend::wait_for_backend(
                    backend::backend_port(),
                    std::time::Duration::from_secs(20),
                ) {
                    let _ = handle.emit("backend-ready", backend::backend_base_url());
                } else {
                    let _ = handle.emit(
                        "backend-error",
                        "Python 后端在限定时间内未就绪（请确认已安装依赖且在 PATH 中可用）",
                    );
                }
            });
            // 确保主窗口尽快可见（不等后端）。
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
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
