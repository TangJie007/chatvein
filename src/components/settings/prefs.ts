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

export type McpKind =
  | "core"
  | "db"
  | "fs"
  | "web"
  | "kb"
  | "code"
  | "shell"
  | "browser"
  | "geo"
  | "ocr"
  | "doc"
  | "custom";

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
    id: "core",
    name: "时间 / 计算 / 本机",
    kind: "core",
    builtin: true,
    desc: "当前时间、时区换算、算术计算、本机概况（系统与磁盘）、ChatVein 数据库概况与已配置模型列表。",
    transport: "本机进程",
    cmd: "builtin://core",
    tools: 6,
    enabled: true,
  },
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
    desc: "默认当前会话工作区；相对路径仅会话内。会话外须绝对路径并经弹窗确认。支持读写、编辑、移动、删除、搜索与目录树。",
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
    id: "mcp-codesandbox",
    name: "代码沙箱",
    kind: "code",
    builtin: true,
    desc: "绑定当前会话工作区：在会话 runs/ 建 venv、写脚本并执行；进程工作目录是会话根（与文件系统工具相同），产物可写 output/。",
    transport: "本机进程",
    cmd: "builtin://mcp-codesandbox",
    tools: 5,
    enabled: true,
  },
  {
    id: "mcp-bash",
    name: "Git Bash",
    kind: "shell",
    builtin: true,
    desc: "优先本机 Git Bash；Windows 未安装时按需下载 MinGit 到数据目录。下载失败则不注入，降级用 PowerShell。",
    transport: "本机进程",
    cmd: "builtin://mcp-bash",
    tools: 2,
    enabled: true,
  },
  {
    id: "mcp-powershell",
    name: "PowerShell",
    kind: "shell",
    builtin: true,
    desc: "仅 Windows。有 Git Bash 时并存；没有时作为唯一 shell。需本机 pwsh 或 Windows PowerShell。",
    transport: "本机进程",
    cmd: "builtin://mcp-powershell",
    tools: 2,
    enabled: true,
  },
  {
    id: "mcp-browser",
    name: "浏览器自动化",
    kind: "browser",
    builtin: true,
    desc: "进程内 Playwright，工具对齐 @playwright/mcp（快照 + ref 交互）。需本机 playwright install chromium；不随包装浏览器。",
    transport: "本机进程",
    cmd: "builtin://mcp-browser",
    tools: 26,
    enabled: true,
  },
  {
    id: "mcp-ip",
    name: "IP 归属地",
    kind: "geo",
    builtin: true,
    desc: "免费归属地：ipinfo → ipwhois → ip-api（无 Key）。查本机公网出口或给定 IP；全失败返回原因。",
    transport: "本机进程",
    cmd: "builtin://mcp-ip",
    tools: 2,
    enabled: true,
  },
  {
    id: "mcp-ocr",
    name: "OCR 识字",
    kind: "ocr",
    builtin: true,
    desc: "先走 OCR.space（公共 key helloworld）；失败则在会话代码沙箱写 RapidOCR 脚本本地识别。",
    transport: "HTTP",
    cmd: "builtin://mcp-ocr",
    tools: 2,
    enabled: true,
  },
  {
    id: "mcp-pdf",
    name: "PDF 处理",
    kind: "doc",
    builtin: true,
    desc: "读取文本与元信息、按页范围拆分、多文件合并、文本生成 PDF、加密/解密。pypdf + reportlab，全部本机处理。",
    transport: "本机进程",
    cmd: "builtin://mcp-pdf",
    tools: 7,
    enabled: true,
  },
  {
    id: "mcp-docx",
    name: "Word 文档",
    kind: "doc",
    builtin: true,
    desc: "从 Markdown-lite 文本生成 .docx（标题 / 列表 / 引言）；按精确替换无损编辑已有 docx。python-docx，无 MS Word / LibreOffice 依赖。",
    transport: "本机进程",
    cmd: "builtin://mcp-docx",
    tools: 2,
    enabled: true,
  },
  {
    id: "mcp-pptx",
    name: "PPT 演示",
    kind: "doc",
    builtin: true,
    desc: "从结构化描述生成 .pptx（16:9，四种主题：neutral / mckinsey / deloitte / ir）；按精确替换无损编辑已有 pptx。python-pptx，无 MS PowerPoint 依赖。",
    transport: "本机进程",
    cmd: "builtin://mcp-pptx",
    tools: 2,
    enabled: true,
  },
  {
    id: "mcp-excel",
    name: "Excel 表格",
    kind: "doc",
    builtin: true,
    desc: "生成多 sheet .xlsx（支持公式 / 值混合，首行 header 加粗并冻结首行）；支持 set_cells / append_rows / add_sheet 三类编辑。openpyxl，无 MS Excel 依赖。",
    transport: "本机进程",
    cmd: "builtin://mcp-excel",
    tools: 2,
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
