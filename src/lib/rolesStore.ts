/** 角色（Agent）配置层。

 * 后端 ``/api/roles`` 已是 SQLite 持久化的唯一数据源，前端不再本地落盘。
 * 这里只保留：类型再导出、内置工具清单，以及「新建角色」时用的默认模板。
 */

export type { RoleRecord, RoleTone, CreateRolePayload } from "../api";

import type { CreateRolePayload, RoleTone } from "../api";

/** 该角色可用的内置工具分组（与 ``prefs.MCP_SERVERS`` / 后端 ``tool_groups`` 对齐）。 */
export const TOOLSET: { id: string; name: string; desc: string }[] = [
  { id: "core", name: "时间 / 计算 / 本机", desc: "当前时间、时区换算、计算器、系统概况" },
  { id: "mcp-fs", name: "文件系统", desc: "读写工作区文件、目录树、搜索与删除" },
  { id: "mcp-web", name: "联网", desc: "web_search / web_fetch" },
  { id: "mcp-sqlite", name: "只读 SQL", desc: "查 ChatVein SQLite 表结构与查询" },
  { id: "mcp-kb", name: "知识库", desc: "笔记沉淀与向量召回" },
  { id: "mcp-codesandbox", name: "代码沙箱", desc: "会话 runs/ 虚拟环境与 Python 执行" },
  { id: "mcp-bash", name: "Git Bash", desc: "本机 Bash（探测到才可用）" },
  { id: "mcp-powershell", name: "PowerShell", desc: "仅 Windows；与 Bash 可并存" },
  { id: "mcp-browser", name: "浏览器", desc: "Playwright 快照 + ref 交互" },
  { id: "mcp-ip", name: "IP 归属地", desc: "公网出口与 IP 查库" },
  { id: "mcp-ocr", name: "OCR 识字", desc: "图片文字识别" },
  { id: "mcp-pdf", name: "PDF 处理", desc: "读取 / 合并 / 拆分 / 生成 / 加解密" },
];

export const DEFAULT_ENABLED_TOOLS = TOOLSET.map((t) => t.id);

const TONE_CYCLE: RoleTone[] = ["violet", "teal", "amber", "peach", "brand"];

/** 新建角色时的默认字段（与后端主角色对齐，但不含 primary）。 */
export function makeNewRole(count: number): CreateRolePayload {
  const tone = TONE_CYCLE[count % TONE_CYCLE.length];
  return {
    name: "新角色",
    initial: "新",
    prompt: "你是一个专注特定场景的助手，按下列约束提供服务。",
    model_id: "",
    tone,
    temperature: 0.7,
    max_tokens: 4096,
    presence_penalty: 0,
    frequency_penalty: 0,
    stream: true,
    json_mode: false,
    retries: 2,
    memory: 8,
    enabled: true,
    tools: DEFAULT_ENABLED_TOOLS,
    kb: [],
  };
}
