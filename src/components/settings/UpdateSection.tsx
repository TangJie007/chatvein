import { DownloadCloud, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkForUpdate,
  currentVersion,
  downloadAndInstall,
  isTauri,
  type UpdateCheckResult,
} from "../../lib/updater";
import { Button } from "../ui/button";
import { loadPrefs } from "./prefs";
import { Card, Note } from "./primitives";

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate"; version: string }
  | { kind: "available"; version: string; body?: string; update: UpdateCheckResult & { available: true } }
  | { kind: "downloading"; percent: number; version: string }
  | { kind: "error"; message: string };

/** 软件更新卡片：手动检查 + 自动检查（autoUpdate 开关）+ 下载进度 + 安装后重启。 */
export function UpdateSection() {
  const [version, setVersion] = useState("…");
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const autoChecked = useRef(false);

  useEffect(() => {
    void currentVersion().then(setVersion).catch(() => setVersion("未知"));
    // 打开设置页时按 autoUpdate 偏好自动查一次（启动时的全局检查在 App 层）。
    if (!autoChecked.current && loadPrefs().autoUpdate) {
      autoChecked.current = true;
      void runCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runCheck = useCallback(async () => {
    setState({ kind: "checking" });
    try {
      const result = await checkForUpdate();
      setState(
        result.available
          ? {
              kind: "available",
              version: result.update.version,
              body: result.update.body,
              update: result,
            }
          : { kind: "uptodate", version }
      );
    } catch (err) {
      setState({ kind: "error", message: messageOf(err) });
    }
  }, [version]);

  const handleInstall = useCallback(async () => {
    const cur = state;
    if (cur.kind !== "available") return;
    setState({ kind: "downloading", percent: 0, version: cur.version });
    try {
      await downloadAndInstall(cur.update.update, (percent) =>
        setState({ kind: "downloading", percent, version: cur.version })
      );
      // Windows 上应用会自行退出并拉起安装器；此处仅在进程仍在时提示。
    } catch (err) {
      setState({ kind: "error", message: messageOf(err) });
    }
  }, [state]);

  const action = (() => {
    switch (state.kind) {
      case "checking":
        return (
          <Button variant="secondary" size="sm" disabled>
            <RefreshCw className="size-3.5 animate-spin" strokeWidth={1.75} />
            检查中…
          </Button>
        );
      case "uptodate":
        return (
          <Button variant="secondary" size="sm" onClick={() => void runCheck()}>
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
            检查更新
          </Button>
        );
      case "available":
        return (
          <Button variant="primary" size="sm" onClick={() => void handleInstall()}>
            <DownloadCloud className="size-3.5" strokeWidth={1.75} />
            下载并安装
          </Button>
        );
      case "downloading":
        return (
          <Button variant="secondary" size="sm" disabled>
            下载中 {state.percent}%
          </Button>
        );
      default:
        return (
          <Button variant="secondary" size="sm" onClick={() => void runCheck()}>
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
            检查更新
          </Button>
        );
    }
  })();

  return (
    <Card
      title="软件更新"
      desc="从更新清单服务器获取新版本，签名校验通过后安装"
      icon={<Sparkles className="size-3.5 text-brand-600" strokeWidth={1.75} />}
      action={isTauri() ? action : undefined}
    >
      <div className="flex items-center gap-3 rounded-xl px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-tint text-brand-600">
          <RefreshCw className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-ink-900">
            当前版本 v{version}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-ink-400">
            {stateText(state)}
          </p>
        </div>
      </div>
      {state.kind === "downloading" && (
        <div className="mx-4 mb-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-brand-600 transition-[width] duration-150"
              style={{ width: `${state.percent}%` }}
            />
          </div>
        </div>
      )}
      {state.kind === "error" && (
        <Note tone="warn">检查失败：{state.message}</Note>
      )}
      {!isTauri() && (
        <Note tone="muted">浏览器预览模式不可用，请在桌面应用中使用更新功能</Note>
      )}
    </Card>
  );
}

function stateText(state: UpdateState): string {
  switch (state.kind) {
    case "idle":
      return "尚未检查";
    case "checking":
      return "正在连接更新服务器…";
    case "uptodate":
      return "已是最新版本";
    case "available":
      return `发现新版本 v${state.version}${state.body ? ` · ${state.body}` : ""}`;
    case "downloading":
      return `正在下载 v${state.version}…`;
    case "error":
      return "本次检查未成功，可稍后重试";
  }
}

function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const start = text.indexOf("{");
  if (start >= 0) {
    try {
      const body = JSON.parse(text.slice(start)) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail) return body.detail;
    } catch {
      /* 非 JSON 时沿用原文 */
    }
  }
  return text;
}
