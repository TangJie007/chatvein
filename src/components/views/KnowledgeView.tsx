import { BookOpen } from "lucide-react";
import { CenterHint } from "../layout/CenterHint";

export function KnowledgeView() {
  return (
    <CenterHint
      title="知识库"
      desc="为多 Agent 共享的检索增强知识来源在此管理。"
      icon={<BookOpen className="size-6" strokeWidth={1.75} />}
    />
  );
}
