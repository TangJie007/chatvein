import { backendRequest } from "./client";

export interface DbVectorInfo {
  loaded: boolean;
  version: string | null;
  error: string | null;
}

export interface DbInfo {
  path: string;
  exists: boolean;
  schema_version: number;
  conversations: number;
  messages: number;
  journal_mode: string;
  sqlite_version: string;
  size_bytes: number;
  logical_bytes: number;
  page_count: number;
  free_pages: number;
  vector_extension: DbVectorInfo;
}

export interface DbTableSummary {
  name: string;
  type: "table" | "view" | string;
  row_count: number | null;
  sql: string;
}

export interface DbColumnInfo {
  cid: number;
  name: string;
  type: string | null;
  notnull: boolean;
  default: string | null;
  pk: boolean;
}

export interface DbTableDetail {
  name: string;
  type: string;
  sql: string;
  columns: DbColumnInfo[];
  total: number | null;
  limit: number;
  offset: number;
  rows: Record<string, unknown>[];
}

export interface WorkspaceInfo {
  path: string;
  label: string;
  custom: boolean;
}

export interface UploadResultFile {
  name?: string;
  path?: string;
  error?: string;
}

/** 当前主空间（文件工具沙箱根）。 */
export function getWorkspace() {
  return backendRequest<WorkspaceInfo>("/api/workspace");
}

/** 把主空间切到用户选择的本机文件夹。 */
export function setWorkspace(path: string) {
  return backendRequest<WorkspaceInfo>("/api/workspace", "PUT", { path });
}

/** 清除自选目录，回到默认主空间。 */
export function resetWorkspace() {
  return backendRequest<WorkspaceInfo>("/api/workspace", "DELETE");
}

/** 把本机文件（拖入/选择的绝对路径，或 base64 内容）落盘到主空间 uploads/，
 *  返回工作区内相对路径，供 OCR / 文件工具解析（沙箱外绝对路径无法被 Agent 读取）。 */
export function uploadFiles(
  files: Array<{ source_path: string } | { content_base64: string; name: string }>,
  conversationId?: string | null
) {
  return backendRequest<{ files: UploadResultFile[] }>("/api/uploads", "POST", {
    files,
    conversation_id: conversationId ?? null,
  });
}

/** Database file location, schema version and row counts. */
export function dbInfo() {
  return backendRequest<DbInfo>("/api/db/info");
}

/** VACUUM the database and return the refreshed stats. */
export function dbVacuum() {
  return backendRequest<DbInfo>("/api/db/vacuum", "POST");
}

/** Copy the database (including WAL) to a timestamped sibling file. */
export function dbBackup() {
  return backendRequest<{ path: string; backup_path: string; size_bytes: number }>(
    "/api/db/backup",
    "POST"
  );
}

/** List all non-system tables and views in the database. */
export async function listDbTables() {
  const data = await backendRequest<{ tables: DbTableSummary[] }>("/api/db/tables");
  return data.tables;
}

/** Fetch columns + first N rows of a single table / view. */
export function getDbTableDetail(name: string, limit = 50, offset = 0) {
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return backendRequest<DbTableDetail>(
    `/api/db/tables/${encodeURIComponent(name)}?${q.toString()}`
  );
}

/** Lightweight health check against the Python backend. */
export async function backendHealth() {
  return backendRequest<{
    status: string;
    service: string;
    python: string;
    db: DbInfo;
  }>("/api/health");
}
