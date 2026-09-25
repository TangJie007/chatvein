import { backendRequest } from "./client";

/** 本机向量模型（ONNX 本地推理，供知识库 / 历史消息检索）。 */
export interface EmbeddingStatus {
  model: string;
  dim: number;
  installed: boolean;
  cache_dir: string;
  endpoint: string;
  /** 实际下载源：modelscope（阿里云国内链路）/ huggingface（HF_ENDPOINT 镜像）。 */
  source?: string;
  downloading: boolean;
  /** 下载进度 0-100；未在下载时为 null。 */
  progress: number | null;
  error: string | null;
}

/** 只读查询：本地向量模型的安装 / 下载状态。 */
export function getEmbeddingStatus() {
  return backendRequest<EmbeddingStatus>("/api/embeddings/status");
}

/** 触发本地向量模型下载（幂等：已在下载则直接返回当前状态）。 */
export function prepareEmbedding(force = false) {
  return backendRequest<EmbeddingStatus>("/api/embeddings/prepare", "POST", { force });
}
