import { useEffect, useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { sendChat, type RoleRecord } from "../../../api";
import { MarkdownMessage } from "../../chat/MarkdownMessage";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";

/** 用角色已保存配置发起一轮临时对话（后端自动新建临时会话，不进入会话列表）。 */
export function TryRunDialog({
  role,
  open,
  onOpenChange,
}: {
  role: RoleRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 打开时预填一句话并清空上次结果；关闭时中止在途请求
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    setText("你好，请用一句话介绍你自己");
    setReply("");
    setError(null);
  }, [open]);

  const run = async () => {
    const content = text.trim();
    if (!content || loading) return;
    setLoading(true);
    setError(null);
    setReply("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await sendChat(
        content,
        null,
        role.id,
        null,
        null,
        controller.signal
      );
      if (controller.signal.aborted) return;
      setReply(res.reply);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "试跑失败，请检查模型配置");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-xl">
        <DialogHeader>
          <DialogTitle>试跑一句 · {role.name}</DialogTitle>
          <DialogDescription>
            使用该角色已保存的配置发起一轮对话，不写入会话列表
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-2">
            <input
              type="text"
              value={text}
              disabled={loading}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void run();
                }
              }}
              placeholder="输入一句想试跑的话…"
              className="min-w-0 flex-1 rounded-xl bg-page px-3 py-2 text-[12.5px] text-ink-900 placeholder-ink-400 shadow-soft focus:outline-none focus-visible:shadow-lift disabled:opacity-60"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={loading || !text.trim()}
              onClick={() => void run()}
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
              ) : (
                <Play className="size-3.5" strokeWidth={1.75} />
              )}
              {loading ? "生成中" : "发送"}
            </Button>
          </div>
          {error ? (
            <p className="text-[12px] leading-5 text-danger-600">{error}</p>
          ) : null}
          <div className="min-h-24 rounded-xl bg-page px-3 py-2.5 shadow-soft">
            {loading ? (
              <span className="flex items-center gap-2 text-[13px] text-ink-400">
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
                思考中…
              </span>
            ) : reply ? (
              <MarkdownMessage content={reply} />
            ) : (
              <span className="text-[13px] leading-6 text-ink-400">
                发送一句试试，看看这个角色的回复风格
              </span>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
