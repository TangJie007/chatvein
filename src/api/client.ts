import { invoke } from "@tauri-apps/api/core";
// Native fetch provided by Tauri's HTTP plugin: the request is executed in Rust
// (reqwest), so browser CORS does not apply and no CSP connect-src is needed.
import { fetch } from "@tauri-apps/plugin-http";

/**
 * The Rust layer launches the Python backend and, at startup, hands the
 * frontend the real base URL (including the dynamically chosen port). The
 * React UI then talks to Python *directly* via fetch — Rust is no longer a
 * per-request proxy, it is just the process / URL provider and event bridge.
 */

let cachedUrl: string | null = null;
/** Set when Rust emits `backend-ready` (or a successful health poll). */
let backendReady = false;

/** Per-run access token handed out by Rust (`backend_token` command). */
let cachedToken: string | null | undefined;

/**
 * The access token for this backend run. The Python side validates every
 * request against it (`CHATVEIN_TOKEN` env var), so only requests carrying
 * `X-ChatVein-Token` are served.
 */
export async function getBackendToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  try {
    cachedToken = await invoke<string>("backend_token");
  } catch {
    // Browser preview without Tauri — no token available.
    cachedToken = null;
  }
  return cachedToken;
}

/** Cache URL from the Rust `backend-ready` event so later requests skip cold start. */
export function markBackendReady(url: string): void {
  cachedUrl = url;
  backendReady = true;
}

/** Rust pushes the real backend URL at startup; this caches it. */
export async function getBackendUrl(): Promise<string> {
  if (cachedUrl) return cachedUrl;
  try {
    cachedUrl = await invoke<string>("backend_url");
  } catch {
    // Browser preview without Tauri — assume the fixed dev port.
    cachedUrl = "http://127.0.0.1:8420";
  }
  return cachedUrl;
}

/** Wait until the Python backend is actually listening (polls /api/health). */
export async function waitForBackend(timeoutMs = 20000): Promise<string> {
  if (backendReady && cachedUrl) return cachedUrl;
  const url = await getBackendUrl();
  const deadline = Date.now() + timeoutMs;
  const token = await getBackendToken();
  const headers = token ? { "X-ChatVein-Token": token } : undefined;
  while (Date.now() < deadline) {
    if (backendReady && cachedUrl) return cachedUrl;
    try {
      const r = await fetch(`${url}/api/health`, { headers });
      if (r.ok) {
        markBackendReady(url);
        return url;
      }
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
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
  signal?: AbortSignal | null
): Promise<T> {
  const url = await waitForBackend();
  try {
    const token = await getBackendToken();
    const headers: Record<string, string> = {};
    if (body) headers["Content-Type"] = "application/json";
    if (token) headers["X-ChatVein-Token"] = token;
    const res = await fetch(`${url}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ?? undefined,
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* keep raw text when not JSON */
    }
    if (!res.ok) {
      throw new Error(httpErrorMessage(res.status, text));
    }
    return data as T;
  } catch (err) {
    // Tauri plugin-http：Rust 抛 string "Request canceled"；JS 侧为 "Request cancelled"。
    if (signal?.aborted || isHttpAbort(err)) {
      const abortErr = new DOMException("Request cancelled", "AbortError");
      throw abortErr;
    }
    throw err;
  }
}

/** 非 2xx：优先取 FastAPI 的 ``detail``（或 message），避免只显示裸 JSON / 状态码。 */
function httpErrorMessage(status: number, text: string): string {
  let detail = text;
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; message?: unknown };
    if (typeof parsed?.detail === "string") detail = parsed.detail;
    else if (Array.isArray(parsed?.detail)) detail = parsed.detail.map(String).join("；");
    else if (typeof parsed?.message === "string") detail = parsed.message;
  } catch {
    /* 非 JSON：保留原文 */
  }
  const body = detail.trim();
  return body ? `请求失败（${status}）：${body}` : `请求失败（${status}）`;
}

function isHttpAbort(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  const msg =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
  const lower = msg.toLowerCase();
  return lower.includes("request canceled") || lower.includes("request cancelled");
}
