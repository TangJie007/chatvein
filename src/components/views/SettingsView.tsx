import { useState } from "react";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Separator } from "../ui/separator";
import { ScrollArea } from "../ui/scroll-area";

type RowProps = {
  title: string;
  desc: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
};

function SettingRow({ title, desc, checked, onCheckedChange }: RowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <Label className="text-[13.5px] text-ink-900">{title}</Label>
        <p className="mt-0.5 text-[12px] leading-5 text-ink-400">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export function SettingsView() {
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [streamReply, setStreamReply] = useState(true);
  const [showInsight, setShowInsight] = useState(true);

  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1 bg-surface">
      <div className="mx-auto max-w-lg px-8 py-8">
        <h1 className="text-[17px] font-semibold text-ink-900">设置</h1>
        <p className="mt-1 text-[13px] text-ink-400">
          偏好项先用 Radix Switch 占位，后续对接 Tauri / 后端配置。
        </p>

        <section className="mt-6 rounded-2xl bg-list px-4 shadow-soft">
          <h2 className="pt-3 text-[12px] font-medium uppercase tracking-wide text-ink-400">
            应用
          </h2>
          <SettingRow
            title="开机启动"
            desc="登录系统后自动打开 ChatVein"
            checked={launchAtLogin}
            onCheckedChange={setLaunchAtLogin}
          />
          <Separator />
          <SettingRow
            title="流式回复"
            desc="助手消息按 token 逐步渲染"
            checked={streamReply}
            onCheckedChange={setStreamReply}
          />
          <Separator />
          <SettingRow
            title="默认展开执行洞察"
            desc="新会话右侧默认显示 ReAct 面板"
            checked={showInsight}
            onCheckedChange={setShowInsight}
          />
        </section>

        <section className="mt-5 rounded-2xl bg-list px-4 py-3 shadow-soft">
          <h2 className="text-[12px] font-medium uppercase tracking-wide text-ink-400">
            数据
          </h2>
          <p className="mt-2 text-[13px] leading-6 text-ink-500">
            SQLite 会话与内置 MCP 配置将迁移到此。现有 <code className="text-ink-700">api.ts</code>{" "}
            可继续复用。
          </p>
        </section>
      </div>
    </ScrollArea>
  );
}
