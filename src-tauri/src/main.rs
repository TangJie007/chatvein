// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 事件循环退出（窗口全关 / ExitRequested）时，lib 内 RunEvent::Exit 兜底杀后端。
    chatvein_lib::run();
}
