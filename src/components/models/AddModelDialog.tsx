import { useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import type { CreateLlmModelPayload } from "../../api";

type AddModelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CreateLlmModelPayload) => Promise<void>;
};

const EMPTY = {
  name: "",
  base_url: "https://api.openai.com/v1",
  model_id: "",
  api_key: "",
};

export function AddModelDialog({
  open,
  onOpenChange,
  onSubmit,
}: AddModelDialogProps) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof EMPTY, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const reset = () => {
    setForm(EMPTY);
    setError(null);
    setSaving(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const modelId = form.model_id.trim();
    if (!name || !modelId) {
      setError("请填写显示名称与模型标识");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name,
        provider: "openai",
        model_id: modelId,
        base_url: form.base_url.trim() || null,
        api_key: form.api_key.trim() || null,
        description: "OpenAI 兼容线上模型",
      });
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加线上模型</DialogTitle>
          <DialogDescription>
            填入接口地址与 API Key，兼容 OpenAI 协议的服务都可以直接接入。
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model-name">显示名称</Label>
            <Input
              id="model-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="例如 GPT-4o"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model-base">接口地址</Label>
            <Input
              id="model-base"
              className="font-mono text-[12px]"
              value={form.base_url}
              onChange={(e) => set("base_url", e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model-id">模型标识</Label>
            <Input
              id="model-id"
              className="font-mono text-[12px]"
              value={form.model_id}
              onChange={(e) => set("model_id", e.target.value)}
              placeholder="gpt-4o-mini"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model-key">API Key</Label>
            <Input
              id="model-key"
              type="password"
              className="font-mono text-[12px]"
              value={form.api_key}
              onChange={(e) => set("api_key", e.target.value)}
              placeholder="sk-..."
            />
          </div>
          {error && (
            <p className="text-[12px] text-danger-600">{error}</p>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "创建中…" : "添加"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
