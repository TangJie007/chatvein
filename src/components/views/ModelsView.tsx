import { Bot } from "lucide-react";
import { CenterHint } from "../layout/CenterHint";

export function ModelsView() {
  return (
    <CenterHint
      title="模型"
      desc="在线 / OpenAI 兼容模型列表与参数配置将在此接入。"
      icon={<Bot className="size-6" strokeWidth={1.75} />}
    />
  );
}
