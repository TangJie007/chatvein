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

/** 应用打开期间轮询待确认的 shell 命令（Bash / PowerShell）。 */
export function BashApproval() {
  const [current, setCurrent] = useState<BashPending | null>(null);
  const [busy, setBusy] = useState(false);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      try {
        const data = await listBashPending();
        if (cancelled) return;
        const next = data.pending[0] ?? null;
        setCurrent((prev) => {
          if (prev && next && prev.id === next.id) return prev;
          return next;
        });
      } catch {
        /* 后端还没起来时保持安静 */
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void tick(), 1000);
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

  return (
    <Dialog open={current !== null} onOpenChange={(open) => !open && void finish(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>允许执行这条命令？</DialogTitle>
          <DialogDescription>
            Bash / PowerShell 都只在当前会话目录里运行。拒绝或关闭都不会执行。
          </DialogDescription>
        </DialogHeader>
        <pre className="select-text max-h-40 overflow-auto rounded-xl bg-page px-3 py-2 text-[12.5px] leading-5 text-ink-800">
          {current?.command}
        </pre>
        <p className="mt-2 text-[12px] text-ink-400">目录 {current?.cwd || "."}</p>
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
