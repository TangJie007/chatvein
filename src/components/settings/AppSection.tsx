import { Copy, Rocket, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import {
  FONT_SCALE_OPTIONS,
  LANG_OPTIONS,
  THEME_OPTIONS,
  type AppPrefs,
} from "./prefs";
import { Card, Note, Row, Select } from "./primitives";

type AppSectionProps = {
  prefs: AppPrefs;
  onSet: <K extends keyof AppPrefs>(key: K, value: AppPrefs[K]) => void;
  dataDir: string | null;
};

export function AppSection({ prefs, onSet, dataDir }: AppSectionProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!dataDir) return;
    try {
      await navigator.clipboard.writeText(dataDir);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 无剪贴板权限时保持原状 */
    }
  };

  return (
    <>
      <Card
        title="外观"
        desc="主题、语言与界面密度"
        icon={<Sparkles className="size-3.5 text-brand-600" strokeWidth={1.75} />}
      >
        <div className="flex flex-col pb-2">
          <Row label="主题" hint="跟随系统会随操作系统深浅色切换">
            <Select
              value={prefs.theme}
              onChange={(v) => onSet("theme", v)}
              options={THEME_OPTIONS}
            />
          </Row>
          <Row label="界面语言">
            <Select
              value={prefs.lang}
              onChange={(v) => onSet("lang", v)}
              options={LANG_OPTIONS}
            />
          </Row>
          <Row label="字号" hint="影响正文与列表的显示密度">
            <Select
              value={prefs.fontScale}
              onChange={(v) => onSet("fontScale", v)}
              options={FONT_SCALE_OPTIONS}
            />
          </Row>
        </div>
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

      <Card
        title="通知与隐私"
        desc="提示方式与诊断数据的处理"
        icon={<ShieldCheck className="size-3.5 text-brand-600" strokeWidth={1.75} />}
      >
        <div className="flex flex-col">
          <Row label="提示音" hint="任务完成或需人工确认时播放">
            <Switch checked={prefs.sound} onCheckedChange={(v) => onSet("sound", v)} />
          </Row>
          <Row label="任务完成通知" hint="窗口不在前台时推送系统通知">
            <Switch
              checked={prefs.notifyOnDone}
              onCheckedChange={(v) => onSet("notifyOnDone", v)}
            />
          </Row>
          <Row label="保留本地运行日志" hint="仅存于本机，用于排查异常">
            <Switch checked={prefs.logs} onCheckedChange={(v) => onSet("logs", v)} />
          </Row>
          <Row label="发送匿名使用统计" hint="不包含会话内容与文件，可随时关闭">
            <Switch
              checked={prefs.telemetry}
              onCheckedChange={(v) => onSet("telemetry", v)}
            />
          </Row>
        </div>
        <Note
          action={
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              disabled={!dataDir}
              onClick={() => void handleCopy()}
            >
              <Copy className="size-3.5" strokeWidth={1.75} />
              {copied ? "已复制" : "复制数据目录"}
            </Button>
          }
        >
          所有会话、知识与数据库文件均保存在本机，不会上传
        </Note>
      </Card>
    </>
  );
}
