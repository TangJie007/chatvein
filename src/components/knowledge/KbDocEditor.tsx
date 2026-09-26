import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  createKbDoc,
  updateKbDoc,
  type KbDoc,
} from "../../api";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export type KbDocEditorProps = {
  open: boolean;
  /** 非空 = 编辑既有文档；null = 新建。 */
  doc: KbDoc | null;
  /** 向量模型是否就绪（新建时提示是否同步建索引）。 */
  vecReady: boolean;
  onClose: () => void;
  /** 保存成功（create 或 update）后回调，参数为落库结果。 */
  onSaved: (doc: KbDoc) => void;
};

/** 新建 / 编辑知识库文档的对话框。 */
export function KbDocEditor({
  open,
  doc,
  vecReady,
  onClose,
  onSaved,
}: KbDocEditorProps) {
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 打开时同步表单初值（编辑回填 / 新建清空）
  useEffect(() => {
    if (!open) return;
    setTitle(doc?.title ?? "");
    setSource(doc?.source ?? "");
    setContent(doc?.content ?? "");
    setError(null);
    setSaving(false);
  }, [open, doc]);

  const canSave = content.trim().length > 0 && !saving;

  async function handleSave() {
    if (!canSave) {
      setError("正文不能为空");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: title.trim() || "untitled",
        content: content.trim(),
        source: source.trim(),
      };
      const saved = doc
        ? await updateKbDoc(doc.id, payload)
        : await createKbDoc(payload);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{doc ? "编辑文档" : "新建笔记"}</DialogTitle>
          <DialogDescription>
            {vecReady
              ? "保存后自动写入向量索引，可被 Agent 语义检索命中。"
              : "向量模型尚未就绪，保存后仅可按关键词检索；就绪后可在「重建索引」补齐。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kb-title">标题</Label>
              <Input
                id="kb-title"
                value={title}
                placeholder="untitled"
                onChange={(e) => setTitle(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="flex w-44 flex-col gap-1.5">
              <Label htmlFor="kb-source">来源</Label>
              <Input
                id="kb-source"
                value={source}
                placeholder="例如 project-notes.md"
                onChange={(e) => setSource(e.target.value)}
                maxLength={500}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kb-content">正文</Label>
            <textarea
              id="kb-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="写下要长期保存、供 Agent 检索引用的内容…"
              rows={10}
              maxLength={100_000}
              className="w-full resize-y rounded-xl bg-surface px-3 py-2.5 text-[13px] leading-6 text-ink-900 shadow-soft placeholder:text-ink-400 focus:outline-none focus-visible:outline-2 focus-visible:outline-brand-600"
            />
            <div className="flex items-center justify-between">
              <p className="text-[10.5px] text-ink-400">
                {content.length.toLocaleString()} / 100,000 字符
              </p>
              {error ? (
                <p className="text-[11px] text-danger-600">{error}</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={!canSave}>
            {saving ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                保存中…
              </>
            ) : (
              "保存"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
