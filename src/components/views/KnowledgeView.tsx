import { BookOpen } from "lucide-react";
import { useEffect } from "react";
import { useEmbedding } from "../embedding/EmbeddingProvider";
import { CenterHint } from "../layout/CenterHint";

export function KnowledgeView() {
  const { ensureReady } = useEmbedding();

  // 进入知识库即确保工作区就绪：本地向量模型未装好时弹出
  // 全局「工作区初始化」弹窗并等待下载完成。
  useEffect(() => {
    void ensureReady();
  }, [ensureReady]);

  return (
    <CenterHint
      title="知识库"
      desc="为多 Agent 共享的检索增强知识来源在此管理。"
      icon={<BookOpen className="size-6" strokeWidth={1.75} />}
    />
  );
}
