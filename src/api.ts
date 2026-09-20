import { invoke } from "@tauri-apps/api/core";

/**
 * The Rust layer (message layer) exposes a single generic proxy command
 * `backend_request` that forwards HTTP calls to the embedded Python backend.
 * The frontend never talks to Python directly — everything goes through Rust.
 */

export interface BackendResponse {
  status: number;
  body: string;
}

/** Generic proxy: forwards an HTTP request to the Python backend via Rust. */
export async function backendRequest(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown
): Promise<BackendResponse> {
  const raw = await invoke<string>("backend_request", {
    endpoint,
    method,
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  return JSON.parse(raw) as BackendResponse;
}

/** Convenience wrapper that parses the JSON body of a backend response. */
export async function backendJson<T = unknown>(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown
): Promise<T> {
  const res = await backendRequest(endpoint, method, body);
  if (res.status >= 400) {
    throw new Error(`Backend error ${res.status}: ${res.body}`);
  }
  return JSON.parse(res.body) as T;
}

/** Lightweight health check against the Python backend. */
export async function backendHealth(): Promise<{ status: string; service: string; python: string }> {
  return backendJson<{ status: string; service: string; python: string }>("/api/health");
}
