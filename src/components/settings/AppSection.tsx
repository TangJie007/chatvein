import { open } from "@tauri-apps/plugin-dialog";
import { Copy, FolderInput, FolderOpen, Rocket, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  getWorkspace,
  resetWorkspace,
  setWorkspace,
  type WorkspaceInfo,
} from "../../api";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import type { AppPrefs } from "./prefs";
import { Card, IconButton, Note, Row } from "./primitives";

type AppSectionProps = {
  prefs: AppPrefs;
  onSet: <K extends keyof AppPrefs>(key: K, value: AppPrefs[K]) => void;
};

export function AppSection({ prefs, onSet }: AppSectionProps) {
  const [workspace, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setWorkspaceInfo(await getWorkspace());
    } catch (err) {
      setWorkspaceInfo(null);
      setBanner(messageOf(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handlePick = async () => {
    setBanner(null);
    let selected: string | null;
    try {
      selected = await open({
        directory: true,
        multiple: false,
        title: "选择主空间",
        defaultPath: workspace?.path,
      });
    } catch {
      setBanner("无法打开文件夹选择器，请在桌面应用里重试");
      return;
    }
    if (!selected?.trim()) return;

    setBusy(true);
    try {
      setWorkspaceInfo(await setWorkspace(selected));
      setBanner("主空间已更新，文件工具会立刻使用这个目录");
    } catch (err) {
      setBanner(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setBusy(true);
    setBanner(null);
    try {
      setWorkspaceInfo(await resetWorkspace());
      setBanner("已恢复默认主空间");
    } catch (err) {
      setBanner(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!workspace) return;
    try {
      await navigator.clipboard.writeText(workspace.path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setBanner("复制失败：当前环境不允许访问剪贴板");
    }
  };

  return (
    <>
      <Card
        title="工作区"
        desc="文件读写、搜索和知识库索引都限制在主空间里"
        icon={<FolderOpen className="size-3.5 text-brand-600" strokeWidth={1.75} />}
      >
        <div className="flex items-center gap-3 rounded-xl px-3.5 py-3 transition-colors hover:bg-tint/50">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-tint text-brand-600">
            <FolderOpen className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[12.5px] font-medium text-ink-900">主空间</span>
              <span className="shrink-0 rounded-full bg-page px-1.5 py-px text-[10px] text-ink-500">
                {workspace ? (workspace.custom ? "自定义" : "默认") : "读取中"}
              </span>
            </div>
            <p className="mt-1 truncate font-mono text-[10.5px] text-ink-400">
              {workspace?.path ?? "正在读取后端…"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              title={copied ? "已复制" : "复制路径"}
              onClick={() => void handleCopy()}
              disabled={!workspace}
            >
              <Copy className="size-3.5" strokeWidth={1.75} />
            </IconButton>
            {workspace?.custom && (
              <IconButton title="恢复默认" onClick={() => void handleReset()} disabled={busy}>
                <RotateCcw className="size-3.5" strokeWidth={1.75} />
              </IconButton>
            )}
          </div>
        </div>
        {banner && (
          <div className="px-3.5 pb-2">
            <p className="rounded-xl bg-page px-3 py-2 text-[11.5px] leading-4 text-ink-500">
              {banner}
            </p>
          </div>
        )}
        <div className="px-3.5 pb-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void handlePick()}
          >
            <FolderInput className="size-3.5" strokeWidth={1.75} />
            {busy ? "保存中…" : "选择文件夹"}
          </Button>
        </div>
        <Note>Agent 不能读写主空间以外的路径</Note>
      </Card>

      <Card
        title="启动与窗口"
        desc="开机行为与关闭时的处理方式"
        icon={<Rocket className="size-3.5 text-brand-600" strokeWidth={1.75} />}
      >
        <div className="flex flex-col pb-2">
          <Row label="开机自动启动" hint="随系统启动并在后台常驻">
            <Switch
              checked={prefs.launchAtLogin}
              onCheckedChange={(v) => onSet("launchAtLogin", v)}
            />
          </Row>
          <Row label="关闭时最小化到托盘" hint="不退出进程，Agent 任务继续执行">
            <Switch
              checked={prefs.closeToTray}
              onCheckedChange={(v) => onSet("closeToTray", v)}
            />
          </Row>
          <Row label="启动时恢复上次窗口" hint="沿用上次的尺寸与位置">
            <Switch
              checked={prefs.restoreWindow}
              onCheckedChange={(v) => onSet("restoreWindow", v)}
            />
          </Row>
          <Row label="自动检查更新" hint="发现新版本时提示，不静默安装">
            <Switch
              checked={prefs.autoUpdate}
              onCheckedChange={(v) => onSet("autoUpdate", v)}
            />
          </Row>
        </div>
      </Card>
    </>
  );
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
