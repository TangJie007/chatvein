/// Expose the real backend base URL (host + port chosen by Rust) to the
/// frontend. The React UI uses this to talk to the Python backend directly,
/// instead of proxying every request through Rust.
#[tauri::command]
pub fn backend_url() -> String {
    crate::backend::backend_base_url()
}

/// Expose this run's access token to the frontend. Every request to the Python
/// backend must carry it in the `X-ChatVein-Token` header; the backend rejects
/// requests without a matching token (also sent via `CHATVEIN_TOKEN`).
#[tauri::command]
pub fn backend_token() -> String {
    crate::backend::backend_token()
}
