/// Expose the real backend base URL (host + port chosen by Rust) to the
/// frontend. The React UI uses this to talk to the Python backend directly,
/// instead of proxying every request through Rust.
#[tauri::command]
pub fn backend_url() -> String {
    crate::backend::backend_base_url()
}
