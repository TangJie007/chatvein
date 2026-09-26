import { backendRequest } from "./client";

/** 知识库概况（/api/kb/status） */
export interface KbStatus {
  db_path: string;
  count: number;
  indexed: number;
  /** 向量模型已安装且 sqlite-vec 可用 */
  vec_ready: boolean;
  model: string;
  model_installed: boolean;
  dim: number;
}

/** 知识库文档（/api/kb/docs 条目 / 详情） */
export interface KbDoc {
  id: string;
  title: string;
  content: string;
  source: string;
  created_at: string;
  /** 是否已写入向量索引（模型未就绪时为 false） */
  indexed: boolean;
  char_count: number;
}

/** 检索命中（/api/kb/search 条目；distance 仅在向量召回时有值） */
export interface KbSearchHit {
  id: string;
  title: string;
  content: string;
  source: string;
  indexed: boolean;
  char_count: number;
  distance?: number | null;
}

export interface KbListResult {
  total: number;
  items: KbDoc[];
  limit: number;
  offset: number;
}

export interface KbImportItem {
  title: string;
  content: string;
  source?: string;
}

export interface KbImportResult {
  created: number;
  indexed: number;
}

export interface KbClearResult {
  deleted: number;
}

export interface KbRebuildResult {
  total: number;
  indexed: number;
}

/** 知识库概况 */
export function getKbStatus(): Promise<KbStatus> {
  return backendRequest<KbStatus>("/api/kb/status");
}

/** 文档列表；q 非空时按标题 / 正文子串过滤 */
export function listKbDocs(
  params: { q?: string; limit?: number; offset?: number } = {}
): Promise<KbListResult> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  query.set("limit", String(params.limit ?? 100));
  query.set("offset", String(params.offset ?? 0));
  return backendRequest<KbListResult>(`/api/kb/docs?${query.toString()}`);
}

/** 单个文档详情 */
export function getKbDoc(id: string): Promise<KbDoc> {
  return backendRequest<KbDoc>(`/api/kb/docs/${encodeURIComponent(id)}`);
}

/** 新增文档 */
export function createKbDoc(payload: {
  title: string;
  content: string;
  source?: string;
}): Promise<KbDoc> {
  return backendRequest<KbDoc>("/api/kb/docs", "POST", payload);
}

/** 更新文档（只更新提供的字段） */
export function updateKbDoc(
  id: string,
  payload: { title?: string; content?: string; source?: string }
): Promise<KbDoc> {
  return backendRequest<KbDoc>(
    `/api/kb/docs/${encodeURIComponent(id)}`,
    "PUT",
    payload
  );
}

/** 删除单篇文档 */
export function deleteKbDoc(id: string): Promise<{ deleted: string }> {
  return backendRequest<{ deleted: string }>(
    `/api/kb/docs/${encodeURIComponent(id)}`,
    "DELETE"
  );
}

/** 语义 / 关键词检索（向量模型就绪时优先向量召回）。
 * hybrid=true 时双路召回 + RRF 融合排序，效果接近 rerank 但无需额外模型。 */
export function searchKb(
  query: string,
  limit = 8,
  hybrid = false
): Promise<{ items: KbSearchHit[] }> {
  return backendRequest<{ items: KbSearchHit[] }>("/api/kb/search", "POST", {
    query,
    limit,
    hybrid,
  });
}

/** 批量导入文档 */
export function importKbDocs(
  items: KbImportItem[]
): Promise<KbImportResult> {
  return backendRequest<KbImportResult>("/api/kb/import", "POST", { items });
}

/** 全量重建向量索引（需要向量模型就绪） */
export function rebuildKbIndex(): Promise<KbRebuildResult> {
  return backendRequest<KbRebuildResult>("/api/kb/rebuild-index", "POST");
}

/** 清空知识库 */
export function clearKb(): Promise<KbClearResult> {
  return backendRequest<KbClearResult>("/api/kb/docs", "DELETE");
}
