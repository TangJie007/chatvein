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

/** 后端掉线时的全局订阅（BackendGate 等用于 UI 降级）。 */
type BackendLostListener = () => void;
const lostListeners = new Set<BackendLostListener>();

/** 订阅后端掉线通知，返回取消订阅函数。 */
export function onBackendLost(fn: BackendLostListener): () => void {
  lostListeners.add(fn);
  return () => lostListeners.delete(fn);
}

/**
 * 后端掉线/重启：复位缓存与就绪标记。
 * 崩溃重启后端口可能变化，cachedUrl 一并清空，下次请求重新获取。
 */
export function markBackendLost(): void {
  const wasReady = backendReady;
  backendReady = false;
  cachedUrl = null;
  if (wasReady) {
    for (const fn of lostListeners) {
      try {
        fn();
      } catch {
        /* 监听器异常不影响主流程 */
      }
    }
  }
}

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

export interface RequestOptions {
  /** 外部取消信号（用户点击停止等）。 */
  signal?: AbortSignal | null;
  /** 请求超时（毫秒）。默认 30s；``<= 0`` 表示不启用超时（由调用方自行取消）。 */
  timeoutMs?: number;
  /** 失败重试次数。默认：GET 1 次，其余 0 次。 */
  retries?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** HTTP 业务错误（非 2xx）：与网络层失败区分，不参与重试/掉线复位。 */
class HttpError extends Error {}

/** 客户端超时：与「用户取消」「网络失败」区分开，UI 才能给出准确提示。
 *  超时只说明前端等不下去了，后端任务多半还在跑，不能当成掉线。 */
export class RequestTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`请求超时（超过 ${Math.round(timeoutMs / 1000)} 秒未返回结果）`);
    this.name = "RequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}
export async function backendRequest<T = unknown>(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const { signal = null, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  // 默认重试策略：GET 重试 1 次（可覆盖），其余不重试（避免非幂等请求重复执行）。
  const retries = options.retries ?? (method === "GET" ? 1 : 0);

  let attempt = 0;
  for (;;) {
    try {
      return await doRequest<T>(endpoint, method, body, signal, timeoutMs);
    } catch (err) {
      if (isUserAbort(signal, err)) throw err;
      if (attempt < retries && isRetryable(err, signal)) {
        attempt += 1;
        await new Promise((r) => setTimeout(r, 300 * attempt));
        continue;
      }
      throw err;
    }
  }
}

async function doRequest<T>(
  endpoint: string,
  method: string,
  body: unknown,
  signal: AbortSignal | null,
  timeoutMs: number
): Promise<T> {
  const url = await waitForBackend();
  // 超时用独立 controller，与调用方取消信号区分开。
  const controller = new AbortController();
  let timedOut = false;
  // timeoutMs <= 0：不装定时器，长任务（生成 / 抠图）交给用户手动停止。
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    const token = await getBackendToken();
    const headers: Record<string, string> = {};
    if (body) headers["Content-Type"] = "application/json";
    if (token) headers["X-ChatVein-Token"] = token;
    const res = await fetch(`${url}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* keep raw text when not JSON */
    }
    if (!res.ok) {
      throw new HttpError(httpErrorMessage(res.status, text));
    }
    return data as T;
  } catch (err) {
    if (isUserAbort(signal, err)) {
      throw new DOMException("Request cancelled", "AbortError");
    }
    // 超时（非用户取消）：后端任务可能仍在跑，只回报超时，不判定后端掉线。
    if (timedOut) throw new RequestTimeoutError(timeoutMs);
    // 连接失败：后端可能已崩溃重启，通知订阅方复位。
    if (isRetryable(err, signal)) {
      markBackendLost();
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

function isRetryable(err: unknown, signal: AbortSignal | null): boolean {
  if (isUserAbort(signal, err)) return false;
  if (err instanceof HttpError) return false; // 业务错误（4xx/5xx）不重试
  if (err instanceof RequestTimeoutError) return false; // 超时重试只会再等一轮，直接交给 UI 提示
  if (isHttpAbort(err)) return false; // 网络层明确取消不重试
  // 超时触发的 AbortError（外层信号未被取消）
  if (err instanceof DOMException && err.name === "AbortError") return true;
  // 非 AbortError 的底层异常（连接拒绝、DNS 失败等）
  return err instanceof Error;
}

function isUserAbort(signal: AbortSignal | null, err: unknown): boolean {
  if (signal?.aborted) return true;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
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
