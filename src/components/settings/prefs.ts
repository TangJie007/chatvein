/** 设置页的本地偏好与内置 MCP 注册表（持久化到 localStorage）。 */

const PREFS_KEY = "chatvein.settings.app.v1";
const MCP_KEY = "chatvein.settings.mcp.v1";

export type AppPrefs = {
  launchAtLogin: boolean;
  closeToTray: boolean;
  restoreWindow: boolean;
  autoUpdate: boolean;
};

export const DEFAULT_PREFS: AppPrefs = {
  launchAtLogin: true,
  closeToTray: true,
  restoreWindow: true,
  autoUpdate: true,
};

export type McpKind = "db" | "fs" | "web" | "kb" | "custom";

export type McpServer = {
  id: string;
  name: string;
  kind: McpKind;
  builtin: boolean;
  desc: string;
  transport: string;
  cmd: string;
  tools: number;
  enabled: boolean;
};

/** 随应用分发的内置协议服务；启用状态由用户覆盖后写回 localStorage。 */
export const MCP_SERVERS: McpServer[] = [
  {
    id: "mcp-sqlite",
    name: "SQLite",
    kind: "db",
    builtin: true,
    desc: "只读查询本机 ChatVein SQLite：列表面、看 schema、跑 SELECT。",
    transport: "本机进程",
    cmd: "builtin://mcp-sqlite --db ./data/chatvein.db",
    tools: 3,
    enabled: true,
  },
  {
    id: "mcp-fs",
    name: "文件系统",
    kind: "fs",
    builtin: true,
    desc: "主空间内的读写、编辑、移动、删除、搜索与目录树，并可在文件管理器中打开文件夹。不含媒体文件读取。根目录在应用设置里选择。",
    transport: "本机进程",
    cmd: "builtin://mcp-fs",
    tools: 15,
    enabled: true,
  },
  {
    id: "mcp-web",
    name: "联网搜索",
    kind: "web",
    builtin: true,
    desc: "先走 Firecrawl 搜索与正文抽取；额度用尽或失败时降级到 DuckDuckGo + 本地抓取。",
    transport: "HTTP",
    cmd: "builtin://mcp-web",
    tools: 2,
    enabled: true,
  },
  {
    id: "mcp-kb",
    name: "知识库检索",
    kind: "kb",
    builtin: true,
    desc: "本地笔记入库与检索；向量模型就绪时走 sqlite-vec，并支持搜历史消息。",
    transport: "本机进程",
    cmd: "builtin://mcp-kb --index ./data/kb.sqlite",
    tools: 4,
    enabled: true,
  },
  {
    id: "mcp-http",
    name: "自定义 HTTP",
    kind: "custom",
    builtin: true,
    desc: "接入任意远程 MCP（HTTP）；填写地址后拉取工具清单（后续接入）。",
    transport: "HTTP",
    cmd: "尚未配置服务地址",
    tools: 0,
    enabled: false,
  },
];

function readJson<T>(key: string): Partial<T> | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式或无 localStorage 时静默降级为内存态 */
  }
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** 读取应用偏好，缺失或损坏时回落到默认值。旧版外观 / 隐私字段会被丢掉。 */
export function loadPrefs(): AppPrefs {
  const stored = readJson<Partial<AppPrefs>>(PREFS_KEY) ?? {};
  return {
    launchAtLogin: asBool(stored.launchAtLogin, DEFAULT_PREFS.launchAtLogin),
    closeToTray: asBool(stored.closeToTray, DEFAULT_PREFS.closeToTray),
    restoreWindow: asBool(stored.restoreWindow, DEFAULT_PREFS.restoreWindow),
    autoUpdate: asBool(stored.autoUpdate, DEFAULT_PREFS.autoUpdate),
  };
}

export function savePrefs(prefs: AppPrefs): void {
  writeJson(PREFS_KEY, prefs);
}

/** 读取内置 MCP 的启用状态（id → enabled）；脏数据会被过滤掉。 */
export function loadMcpState(): Record<string, boolean> {
  const stored = readJson<Record<string, boolean>>(MCP_KEY) ?? {};
  return Object.fromEntries(
    Object.entries(stored).filter(([, enabled]) => typeof enabled === "boolean")
  ) as Record<string, boolean>;
}

export function saveMcpState(state: Record<string, boolean>): void {
  writeJson(MCP_KEY, state);
}

/** 内置 MCP 列表 = 默认注册表 + 用户保存过的启用状态。 */
export function hydrateMcpServers(): McpServer[] {
  const state = loadMcpState();
  return MCP_SERVERS.map((s) =>
    s.id in state ? { ...s, enabled: state[s.id] === true } : s
  );
}
