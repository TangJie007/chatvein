use crate::AppState;
use serde_json::json;
use tauri::State;

/// Health check against the Python backend. Returns the raw JSON string.
#[tauri::command]
pub async fn backend_health(state: State<'_, AppState>) -> Result<String, String> {
    let url = format!("{}/api/health", crate::backend::backend_base_url());
    let resp = state
        .http
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let text = resp.text().await.map_err(|e| e.to_string())?;
    Ok(text)
}

/// Generic message-layer proxy: forward an HTTP request to the Python backend.
///
/// `body` is an optional JSON string. The response is returned as
/// `{"status": <http_status>, "body": <response_text>}` so the UI can inspect
/// both the status code and the payload.
#[tauri::command]
pub async fn backend_request(
    state: State<'_, AppState>,
    endpoint: String,
    method: String,
    body: Option<String>,
) -> Result<String, String> {
    let url = format!("{}{}", crate::backend::backend_base_url(), endpoint);
    let method = method.to_uppercase();

    let mut builder = match method.as_str() {
        "GET" => state.http.get(&url),
        "POST" => state.http.post(&url),
        "PUT" => state.http.put(&url),
        "DELETE" => state.http.delete(&url),
        other => return Err(format!("不支持的 HTTP 方法: {other}")),
    };

    if let Some(b) = body {
        builder = builder
            .header("Content-Type", "application/json")
            .body(b);
    }

    let resp = builder.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    Ok(json!({ "status": status, "body": text }).to_string())
}
