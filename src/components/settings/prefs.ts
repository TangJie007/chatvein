/** 设置页的本地偏好与内置 MCP 注册表（持久化到 localStorage）。 */

const PREFS_KEY = "chatvein.settings.app.v1";
const MCP_KEY = "chatvein.settings.mcp.v1";

export type AppPrefs = {
  theme: string;
  lang: string;
  fontScale: string;
  launchAtLogin: boolean;
  closeToTray: boolean;
  restoreWindow: boolean;
  autoUpdate: boolean;
  sound: boolean;
  notifyOnDone: boolean;
  telemetry: boolean;
  logs: boolean;
};

export const THEME_OPTIONS = ["跟随系统", "浅色", "深色"] as const;
export const LANG_OPTIONS = ["简体中文", "English", "日本語"] as const;
export const FONT_SCALE_OPTIONS = ["紧凑", "标准", "宽松"] as const;

export const DEFAULT_PREFS: AppPrefs = {
  theme: "跟随系统",
  lang: "简体中文",
  fontScale: "标准",
  launchAtLogin: true,
  closeToTray: true,
  restoreWindow: true,
  autoUpdate: true,
  sound: true,
  notifyOnDone: true,
  telemetry: false,
  logs: true,
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
    desc: "工作区沙箱内的列表 / 读写 / glob / grep（默认 ~/ChatVeinWorkspace）。",
    transport: "本机进程",
    cmd: "builtin://mcp-fs --root ~/ChatVeinWorkspace",
    tools: 6,
    enabled: true,
  },
  {
    id: "mcp-web",
    name: "联网搜索",
    kind: "web",
    builtin: true,
    desc: "DuckDuckGo 检索与网页正文抽取，为问答补充实时信息。",
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

/** 读取应用偏好，缺失或损坏时回落到默认值。 */
export function loadPrefs(): AppPrefs {
  const stored = readJson<AppPrefs>(PREFS_KEY);
  const merged: AppPrefs = { ...DEFAULT_PREFS, ...(stored ?? {}) };
  // 下拉框选项可能随版本变化，落库的旧值要收敛回当前选项
  if (!(THEME_OPTIONS as readonly string[]).includes(merged.theme)) {
    merged.theme = DEFAULT_PREFS.theme;
  }
  if (!(LANG_OPTIONS as readonly string[]).includes(merged.lang)) {
    merged.lang = DEFAULT_PREFS.lang;
  }
  if (!(FONT_SCALE_OPTIONS as readonly string[]).includes(merged.fontScale)) {
    merged.fontScale = DEFAULT_PREFS.fontScale;
  }
  return merged;
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
