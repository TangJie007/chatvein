import { useEffect, useRef, useState } from "react";
import { approveBash, denyBash, listBashPending, type BashPending } from "../../api";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

/** 应用打开期间轮询待确认的操作（Shell 命令 / 会话外文件路径）。 */
export function BashApproval() {
  const [current, setCurrent] = useState<BashPending | null>(null);
  const [busy, setBusy] = useState(false);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    // 有待确认项时固定快速轮询；无待确认项时指数退避，减少空转请求。
    const FAST = 1000;
    const MAX_BACKOFF = 5000;
    let backoff = FAST;
    const tick = async () => {
      try {
        const data = await listBashPending();
        if (cancelled) return;
        const next = data.pending[0] ?? null;
        setCurrent((prev) => {
          if (prev && next && prev.id === next.id) return prev;
          return next;
        });
        // 出现待确认项立即恢复快速轮询；否则指数退避并封顶
        backoff = next ? FAST : Math.min(backoff * 2, MAX_BACKOFF);
      } catch {
        /* 后端还没起来时保持安静，同样退避 */
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void tick(), backoff);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const finish = async (allow: boolean) => {
    if (!current || handled.current === current.id) return;
    handled.current = current.id;
    setBusy(true);
    try {
      if (allow) await approveBash(current.id);
      else await denyBash(current.id);
    } catch {
      /* 已经确认过时接口会 404 */
    } finally {
      setBusy(false);
      setCurrent(null);
    }
  };

  const isPathOp = Boolean(current?.command?.includes("\n"));

  return (
    <Dialog open={current !== null} onOpenChange={(open) => !open && void finish(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isPathOp ? "允许访问此路径？" : "允许执行这条命令？"}</DialogTitle>
          <DialogDescription>
            {isPathOp
              ? "会话工作区内的文件操作可直接执行；会话外路径需要你确认。拒绝或关闭都不会执行。"
              : "Bash / PowerShell 都只在当前会话目录里运行。拒绝或关闭都不会执行。"}
          </DialogDescription>
        </DialogHeader>
        <pre className="select-text max-h-40 overflow-auto rounded-xl bg-page px-3 py-2 text-[12.5px] leading-5 text-ink-800">
          {current?.command}
        </pre>
        <p className="mt-2 text-[12px] text-ink-400">
          {isPathOp ? "位置" : "目录"} {current?.cwd || "."}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => void finish(false)}>
            拒绝
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void finish(true)}>
            允许
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
