mod backend;
mod commands;

use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

/// Entry point called from `main.rs`.
pub fn run() {
    // 崩溃现场尽力落盘（独立于日志插件，确保任何阶段 panic 都有痕迹）
    std::panic::set_hook(Box::new(|info| {
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "<非字符串 panic>".to_string());
        let location = info.location().map(|l| l.to_string()).unwrap_or_default();
        let msg = format!("[panic] {payload}\n  at {location}\n");
        eprintln!("{msg}");
        if let Some(dir) = std::env::var_os("CHATVEIN_DATA_DIR") {
            let path = std::path::PathBuf::from(dir).join("crash.log");
            use std::io::Write;
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .map(|mut f| f.write_all(msg.as_bytes()));
        }
    }));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // 日志：落盘（app log dir / chatvein.log，随进程轮转）+ 终端
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    Target::new(TargetKind::LogDir {
                        file_name: Some("chatvein.log".into()),
                    }),
                    Target::new(TargetKind::Stdout),
                ])
                .build(),
        )
        // 自动更新：check() 只做版本比对；下载安装与 relaunch 由前端触发
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 安装完成后 relaunch 用
        .plugin(tauri_plugin_process::init())
        // 单实例：二次启动聚焦既有窗口，避免双后端写同一 SQLite
        .plugin(
            tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }),
        )
        .setup(|app| {
            #[cfg(debug_assertions)]
            backend::free_dev_backend_port();

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
        .invoke_handler(tauri::generate_handler![
            commands::backend_url,
            commands::backend_token
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        // 所有窗口关闭 / 退出事件循环时兜底杀掉后端（含 Job Object 进程树）
        if let tauri::RunEvent::Exit = event {
            backend::kill_backend();
        }
    });
}
