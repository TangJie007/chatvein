import { useEffect, useRef, useState } from "react";
import { decideApproval, listApprovals, type ApprovalItem } from "../../api";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

/** 应用打开期间轮询待确认的动作（命令 / 会话外路径 / 需要审批的工具调用）。 */
export function BashApproval() {
  const [current, setCurrent] = useState<ApprovalItem | null>(null);
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
        const data = await listApprovals();
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
      await decideApproval(current.id, allow);
    } catch {
      /* 已超时 / 已被其他入口决定时接口返回 404 */
    } finally {
      setBusy(false);
      setCurrent(null);
    }
  };

  const kind = current?.kind ?? "bash";
  const isPath = kind === "path";
  const hint = isPath
    ? "会话工作区内的文件操作可直接执行；会话外路径需要你确认。拒绝或关闭都不会执行。"
    : kind === "bash" || kind === "powershell"
      ? "Bash / PowerShell 都只在当前会话目录里运行。拒绝或关闭都不会执行。"
      : "这个操作会改动工作区或会话数据，需要你确认后才会执行。";
  const riskLabel = current?.risk === "high" ? "较高风险" : current?.risk === "low" ? "低风险" : "";
  const kindLabel = isPath ? "路径" : kind === "bash" || kind === "powershell" ? "命令" : "操作";

  return (
    <Dialog open={current !== null} onOpenChange={(open) => !open && void finish(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{current?.title || "允许这个操作？"}</DialogTitle>
          <DialogDescription>{hint}</DialogDescription>
        </DialogHeader>
        <pre className="select-text max-h-40 overflow-auto rounded-xl bg-page px-3 py-2 text-[12.5px] leading-5 text-ink-800">
          {current?.detail || current?.command}
        </pre>
        <p className="mt-2 text-[12px] text-ink-400">
          {kindLabel}
          {current?.cwd && current.cwd !== "." ? ` · ${current.cwd}` : ""}
          {riskLabel ? ` · ${riskLabel}` : ""}
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
