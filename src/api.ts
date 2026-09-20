import { invoke } from "@tauri-apps/api/core";

/**
 * The Rust layer launches the Python backend and, at startup, hands the
 * frontend the real base URL (including the dynamically chosen port). The
 * React UI then talks to Python *directly* via fetch — Rust is no longer a
 * per-request proxy, it is just the process / URL provider and event bridge.
 */

let cachedUrl: string | null = null;

/** Rust pushes the real backend URL at startup; this caches it. */
export async function getBackendUrl(): Promise<string> {
  if (cachedUrl) return cachedUrl;
  cachedUrl = await invoke<string>("backend_url");
  return cachedUrl;
}

/** Wait until the Python backend is actually listening (polls /api/health). */
export async function waitForBackend(timeoutMs = 20000): Promise<string> {
  const url = await getBackendUrl();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) return url;
    } catch {
      // not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Python 后端在限定时间内未就绪");
}

/** Direct fetch to the Python backend (frontend talks to it straight). */
export async function backendRequest<T = unknown>(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown
): Promise<T> {
  const url = await waitForBackend();
  const res = await fetch(`${url}${endpoint}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep raw text when not JSON */
  }
  if (!res.ok) {
    throw new Error(`Backend ${res.status}: ${text}`);
  }
  return data as T;
}

/** Lightweight health check against the Python backend. */
export async function backendHealth() {
  return backendRequest<{ status: string; service: string; python: string }>(
    "/api/health"
  );
}
