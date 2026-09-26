import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import {
  importKbDocs,
  type KbImportItem,
  type KbImportResult,
} from "../../api";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 单文件 2MB
const MAX_CONTENT_CHARS = 100_000; // 与后端一致
const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|log|json|csv|tsv|xml|yaml|yml|toml|ini|py|ts|tsx|js|jsx|rs|go|java|css|html|vue|sql|sh|bat|ps1)$/i;

export type KbImportDialogProps = {
  open: boolean;
  onClose: () => void;
  /** 导入成功后回调（参数为导入统计）。 */
  onImported: (result: KbImportResult) => void;
};

type PendingFile = { name: string; size: number; text: string };

/** 导入本地文本文件 / 粘贴文本到知识库。 */
export function KbImportDialog({ open, onClose, onImported }: KbImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  function reset() {
    setPending([]);
    setPaste("");
    setError(null);
    setBusy(false);
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const accepted: PendingFile[] = [];
    for (const file of Array.from(files)) {
      const ok =
        file.type.startsWith("text/") ||
        file.type === "application/json" ||
        TEXT_EXTENSIONS.test(file.name);
      if (!ok) {
        setError(`「${file.name}」不是支持的文本格式（仅 txt/md/log/json/代码文件等）`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(`「${file.name}」超过 2MB 限制，已跳过`);
        continue;
      }
      try {
        const text = await file.text();
        accepted.push({
          name: file.name,
          size: file.size,
          text: text.slice(0, MAX_CONTENT_CHARS),
        });
      } catch {
        setError(`「${file.name}」读取失败，已跳过`);
      }
    }
    if (accepted.length) {
      setPending((prev) => [...prev, ...accepted]);
      setError(null);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    void handleFiles(e.dataTransfer.files);
  }

  function buildItems(): KbImportItem[] {
    const items: KbImportItem[] = [];
    for (const p of pending) {
      const text = p.text.trim();
      if (!text) continue;
      items.push({ title: p.name, content: text, source: p.name });
    }
    if (paste.trim()) {
      const text = paste.trim().slice(0, MAX_CONTENT_CHARS);
      const firstLine = text.split("\n")[0]?.trim().slice(0, 60);
      items.push({
        title: firstLine || "粘贴笔记",
        content: text,
        source: "pasted",
      });
    }
    return items;
  }

  async function handleImport() {
    const items = buildItems();
    if (!items.length) {
      setError("请选择文件或粘贴文本");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await importKbDocs(items);
      reset();
      onImported(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>导入知识库</DialogTitle>
          <DialogDescription>
            支持 txt / md / log / json / CSV 及常见代码文本，单文件 2MB 内、单篇不超过 10 万字符。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* 文件区 */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 transition-colors ${
              dragOver
                ? "border-brand-500 bg-brand-500/5"
                : "border-line bg-surface hover:border-ink-300"
            }`}
          >
            <Upload className="size-5 text-ink-400" />
            <p className="text-[12.5px] font-medium text-ink-700">
              拖拽文件到此处，或点击选择
            </p>
            <p className="text-[11px] text-ink-400">可多选</p>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".txt,.md,.markdown,.log,.json,.csv,.tsv,.xml,.yaml,.yml,.toml,.ini,.py,.ts,.tsx,.js,.jsx,.rs,.go,.java,.css,.html,.vue,.sql,.sh,.bat,.ps1,text/*,application/json"
              className="hidden"
              onChange={(e) => {
                void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {/* 待导入列表 */}
          {pending.length > 0 ? (
            <ScrollArea className="max-h-40 rounded-lg border border-line bg-page/60">
              <ul className="flex flex-col">
                {pending.map((p, i) => (
                  <li
                    key={`${p.name}-${i}`}
                    className="flex items-center justify-between gap-2 border-b border-line/60 px-3 py-2 text-[12.5px] last:border-b-0"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FileText className="size-3.5 shrink-0 text-ink-400" />
                      <span className="truncate text-ink-800">{p.name}</span>
                      <span className="shrink-0 text-[10.5px] text-ink-400">
                        {(p.size / 1024).toFixed(1)}KB
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPending((prev) => prev.filter((_, j) => j !== i))
                      }
                      className="text-ink-400 transition-colors hover:text-danger-600"
                      aria-label="移除"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          ) : null}

          {/* 粘贴区 */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[12px] font-medium text-ink-700">或粘贴文本</p>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="把一段文字粘贴到这里，作为一篇笔记导入…"
              rows={4}
              maxLength={MAX_CONTENT_CHARS}
              className="w-full resize-y rounded-xl bg-surface px-3 py-2 text-[12.5px] leading-5 text-ink-900 shadow-soft placeholder:text-ink-400 focus:outline-none focus-visible:outline-2 focus-visible:outline-brand-600"
            />
          </div>

          {error ? (
            <p className="text-[11px] text-danger-600">{error}</p>
          ) : null}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-[11px] text-ink-400">
            将导入 {pending.length + (paste.trim() ? 1 : 0)} 篇文档
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={close} disabled={busy}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={handleImport}
              disabled={busy || (!pending.length && !paste.trim())}
            >
              {busy ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  导入中…
                </>
              ) : (
                "开始导入"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
