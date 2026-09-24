import { Loader2 } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getEmbeddingStatus,
  prepareEmbedding,
  type EmbeddingStatus,
} from "../../api";
import { cn } from "../../lib/cn";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

/** 工作区就绪结果：ready=false 表示下载失败（status.error 为原因）。 */
export type ReadyResult = { ready: boolean; status: EmbeddingStatus };

type EmbeddingContextValue = {
  /** 最近一次轮询到的本地向量模型状态；后端未就绪前为 null。 */
  status: EmbeddingStatus | null;
  /** 模型是否已就绪（已安装且无错误）。 */
  installed: boolean;
  /** 下载进度 0-100；未在下载时为 null，安装完成后为 100。 */
  progress: number | null;
  /**
   * 请求「工作区就绪」：模型未就绪时弹出全局「工作区初始化」弹窗并等待
   * 下载完成。并发调用共享同一等待（不重复弹窗）。永不 reject。
   */
  ensureReady: () => Promise<ReadyResult>;
};

const EmbeddingContext = createContext<EmbeddingContextValue | null>(null);

/** 读取全局本地向量模型状态；必须在 EmbeddingProvider 内使用。 */
export function useEmbedding(): EmbeddingContextValue {
  const ctx = useContext(EmbeddingContext);
  if (!ctx) throw new Error("useEmbedding 必须在 EmbeddingProvider 内使用");
  return ctx;
}

/** 下载进度轮询间隔（毫秒）。 */
const POLL_MS = 1000;

function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return String(err);
}

export function EmbeddingProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  /** 最新状态镜像：供回调 / 轮询闭包读取，避免捕获过期 state。 */
  const statusRef = useRef<EmbeddingStatus | null>(null);
  /** 轮询定时器 id；非 null 表示轮询进行中。 */
  const pollTimerRef = useRef<number | null>(null);
  /** 当前「工作区就绪」等待者（多个调用方共享同一个 promise）。 */
  const waiterRef = useRef<{
    resolve: (r: ReadyResult) => void;
    promise: Promise<ReadyResult>;
  } | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const ensurePolling = useCallback(() => {
    if (pollTimerRef.current !== null) return;
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const s = await getEmbeddingStatus();
        applyStatusRef.current(s);
      } catch {
        /* 后端瞬断：下个 tick 再试 */
      }
    }, POLL_MS);
  }, []);

  /** 下载结束（或失败）时结算等待者；下载中则继续等。 */
  const settleWaiter = useCallback((s: EmbeddingStatus) => {
    if (s.downloading) return;
    const waiter = waiterRef.current;
    if (!waiter) return;
    waiterRef.current = null;
    const ok = s.installed && !s.error;
    if (ok) {
      setDialogOpen(false);
      setDialogError(null);
    } else {
      setDialogError(s.error ?? "本地向量模型下载失败");
      // 弹窗保持打开展示错误，调用方同时拿到 ready=false 自行提示。
    }
    waiter.resolve({ ready: ok, status: s });
  }, []);

  /** 统一入口：写入最新状态并驱动「轮询 / 结算等待者」。 */
  const applyStatus = useCallback(
    (s: EmbeddingStatus) => {
      setStatus(s);
      statusRef.current = s;
      if (s.downloading) {
        ensurePolling();
      } else {
        stopPolling();
      }
      settleWaiter(s);
    },
    [ensurePolling, stopPolling, settleWaiter]
  );
  const applyStatusRef = useRef(applyStatus);
  applyStatusRef.current = applyStatus;

  /**
   * 打开软件即静默安装：未安装且未在下载时自动触发，进度由轮询驱动，
   * 用户进入模型管理 / 知识库 / 新建对话时才展示。
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getEmbeddingStatus();
        if (cancelled) return;
        applyStatus(s);
        if (!s.installed && !s.downloading && !s.error) {
          const started = await prepareEmbedding();
          if (cancelled) return;
          applyStatus(started);
        }
      } catch {
        /* 后端可能还在启动，静默忽略 */
      }
    })();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [applyStatus, stopPolling]);

  const ensureReady = useCallback((): Promise<ReadyResult> => {
    const cur = statusRef.current;
    if (cur?.installed && !cur.error) {
      return Promise.resolve({ ready: true, status: cur });
    }
    setDialogError(null);
    setDialogOpen(true);
    // 已有等待者（如另一个视图正在等）：复用同一 promise，只重新打开弹窗。
    if (waiterRef.current) return waiterRef.current.promise;

    let resolveFn: (r: ReadyResult) => void = () => {};
    const promise = new Promise<ReadyResult>((res) => {
      resolveFn = res;
    });
    waiterRef.current = { resolve: resolveFn, promise };

    if (cur?.downloading) {
      ensurePolling();
    } else {
      // 未安装也未在下载：先触发下载再等。
      void prepareEmbedding()
        .then((s) => applyStatus(s))
        .catch((err) => {
          applyStatus({
            model: cur?.model ?? "",
            dim: cur?.dim ?? 0,
            installed: false,
            cache_dir: cur?.cache_dir ?? "",
            endpoint: cur?.endpoint ?? "",
            downloading: false,
            progress: null,
            error: errorMessage(err),
          });
        });
    }
    return promise;
  }, [applyStatus, ensurePolling]);

  const value = useMemo<EmbeddingContextValue>(
    () => ({
      status,
      installed: !!status?.installed && !status.error,
      progress: status
        ? status.downloading
          ? status.progress ?? 0
          : status.installed && !status.error
            ? 100
            : null
        : null,
      ensureReady,
    }),
    [status, ensureReady]
  );

  const downloading = !!status?.downloading;
  const pct = Math.round(Math.min(100, Math.max(0, status?.progress ?? 0)));

  return (
    <EmbeddingContext.Provider value={value}>
      {children}
      <Dialog open={dialogOpen} onOpenChange={(open) => !open && setDialogOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>工作区初始化</DialogTitle>
            <DialogDescription>
              本地向量模型首次使用需下载权重，下载完成后知识库与历史检索即可工作。
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2.5">
            {downloading ? (
              <>
                <div className="flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin text-brand-600" strokeWidth={2} />
                  <span className="text-[12.5px] text-ink-700">正在下载模型权重…</span>
                  <span className="ml-auto font-mono text-[12px] font-medium text-ink-900">
                    {pct}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-page">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-[width] duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[10.5px] text-ink-400">
                  受网络影响可能较慢，可前往「模型管理」查看详情；此窗口可关闭，下载在后台继续。
                </p>
              </>
            ) : dialogError ? (
              <>
                <p className="rounded-xl bg-warn-50 px-3 py-2 text-[12px] leading-5 text-warn-600">
                  {dialogError}
                </p>
                <p className="text-[10.5px] text-ink-400">
                  下载失败，可关闭后重试，或到「模型管理」检查网络与镜像配置。
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-1 self-end"
                  onClick={() => {
                    setDialogOpen(false);
                    setDialogError(null);
                  }}
                >
                  关闭
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-2 py-1">
                <Loader2 className="size-3.5 animate-spin text-brand-600" strokeWidth={2} />
                <span className={cn("text-[12.5px] text-ink-700")}>正在准备本地模型…</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </EmbeddingContext.Provider>
  );
}
