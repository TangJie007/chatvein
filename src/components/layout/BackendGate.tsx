import { listen } from "@tauri-apps/api/event";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  getBackendUrl,
  markBackendReady,
  onBackendLost,
  waitForBackend,
} from "../../api";
import { TitleBar } from "./TitleBar";

type Status = "loading" | "ready" | "error";

/**
 * Show the shell immediately; block routes until Python is reachable.
 *
 * 运行期支持「掉线 → 自动重连 → 恢复」流转：
 * - Rust 广播 `backend-exited`（异常退出，自动重启中）→ 进入 loading；
 * - Rust 广播 `backend-error`（启动失败 / 重启超限）→ 进入 error；
 * - API 层探测到连接失败（markBackendLost）→ 进入 loading 重连态；
 * - 新进程就绪广播 `backend-ready` / 健康轮询成功 → 回到 ready。
 */
export function BackendGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const statusRef = useRef<Status>("loading");

  const setStatusSafe = (next: Status, nextMessage: string | null) => {
    statusRef.current = next;
    setStatus(next);
    setMessage(nextMessage);
  };

  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];

    const goReady = (url: string) => {
      if (cancelled) return;
      markBackendReady(url);
      setStatusSafe("ready", null);
    };
    const goError = (msg: string) => {
      if (cancelled) return;
      setStatusSafe("error", msg);
    };
    const goLoading = (msg: string) => {
      if (cancelled) return;
      setStatusSafe("loading", msg);
    };

    void (async () => {
      try {
        unsubs.push(
          await listen<string>("backend-ready", (e) => {
            const url =
              typeof e.payload === "string" && e.payload ? e.payload : null;
            if (url) goReady(url);
            else void getBackendUrl().then(goReady);
          })
        );
        unsubs.push(
          await listen<string>("backend-exited", (e) => {
            goLoading(
              typeof e.payload === "string" && e.payload
                ? e.payload
                : "Python 后端异常，正在自动重启…"
            );
          })
        );
        unsubs.push(
          await listen<string>("backend-error", (e) => {
            goError(
              typeof e.payload === "string" && e.payload
                ? e.payload
                : "后端启动失败"
            );
          })
        );
      } catch {
        // Not running under Tauri — fall through to health poll.
      }

      // API 层探测到连接断开 → 重连态（markBackendLost 仅在就绪后触发）。
      unsubs.push(
        onBackendLost(() => {
          if (statusRef.current === "ready") {
            goLoading("与后端的连接已断开，正在自动重连…");
          }
        })
      );

      try {
        goReady(await waitForBackend(20000));
      } catch (e) {
        // Rust 可能已通过事件就绪 / 掉线后由事件接管，忽略晚到的轮询失败。
        if (cancelled || statusRef.current === "ready") return;
        goError(e instanceof Error ? e.message : "后端启动失败");
      }
    })();

    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, []);

  if (status === "ready") return <>{children}</>;

  return (
    <div className="relative flex h-screen w-screen min-h-[700px] min-w-[1250px] flex-col overflow-hidden bg-page font-sans text-ink-900 antialiased select-none">
      <TitleBar />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8">
        {status === "loading" ? (
          <>
            <div
              className="h-8 w-8 animate-spin rounded-full border-2 border-brand-100 border-t-brand-600"
              aria-hidden
            />
            <p className="text-sm text-ink-500">
              {message ?? "数据库与工作空间加载中，请等待"}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-danger-600">后端未能启动</p>
            <p className="max-w-md text-center text-sm text-ink-500">
              {message ?? "未知错误"}
            </p>
            <button
              type="button"
              className="mt-2 rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700"
              onClick={() => window.location.reload()}
            >
              重试
            </button>
          </>
        )}
      </div>
    </div>
  );
}
