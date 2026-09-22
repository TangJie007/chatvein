import { listen } from "@tauri-apps/api/event";
import { type ReactNode, useEffect, useState } from "react";
import { getBackendUrl, markBackendReady, waitForBackend } from "../../api";
import { TitleBar } from "./TitleBar";

type Status = "loading" | "ready" | "error";

/**
 * Show the shell immediately; block routes until Python is reachable.
 * Rust emits `backend-ready` / `backend-error` from a background probe;
 * we also poll `/api/health` so a late listener still recovers.
 */
export function BackendGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let settled = false;
    const unsubs: Array<() => void> = [];

    const settleReady = (url: string) => {
      if (cancelled || settled) return;
      settled = true;
      markBackendReady(url);
      setStatus("ready");
    };

    const settleError = (msg: string) => {
      if (cancelled || settled) return;
      settled = true;
      setError(msg);
      setStatus("error");
    };

    void (async () => {
      try {
        unsubs.push(
          await listen<string>("backend-ready", (e) => {
            const url =
              typeof e.payload === "string" && e.payload
                ? e.payload
                : null;
            if (url) settleReady(url);
            else void getBackendUrl().then(settleReady);
          })
        );
        unsubs.push(
          await listen<string>("backend-error", (e) => {
            settleError(
              typeof e.payload === "string" && e.payload
                ? e.payload
                : "后端启动失败"
            );
          })
        );
      } catch {
        // Not running under Tauri — fall through to health poll.
      }

      try {
        settleReady(await waitForBackend(20000));
      } catch (e) {
        // Rust may already have settled via event; ignore late poll failure.
        if (settled || cancelled) return;
        settleError(e instanceof Error ? e.message : "后端启动失败");
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
            <p className="text-sm text-ink-500">数据库与工作空间加载中，请等待</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-danger-600">后端未能启动</p>
            <p className="max-w-md text-center text-sm text-ink-500">
              {error ?? "未知错误"}
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
